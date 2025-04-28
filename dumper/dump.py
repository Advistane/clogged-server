# dumper/dump.py
import os
import shutil
import subprocess
import logging # Use logging instead of print for better integration

# Setup basic logging if not already done in main script
# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Define paths relative to the WORKDIR (/app) inside the container
JAR_PATH = '/cache-1.11.8-SNAPSHOT-jar-with-dependencies.jar'
CACHE_DIR_INPUT = '/cache' # This path will be mounted from the host
ITEMS_DIR_OUTPUT = '/items'
NPCS_DIR_OUTPUT = '/npcs'

# Use 'java', not 'java.exe'
# Use the absolute paths defined above
items_command = [
    'java', '-jar', JAR_PATH,
    '-c', CACHE_DIR_INPUT,
    '-items', ITEMS_DIR_OUTPUT
]

npc_command = [
    'java', '-jar', JAR_PATH,
    '-c', CACHE_DIR_INPUT,
    '-npcs', NPCS_DIR_OUTPUT
]

def ensure_dir_exists(dir_path):
    """Creates a directory if it doesn't exist."""
    if not os.path.exists(dir_path):
        logging.info(f"Creating directory: {dir_path}")
        os.makedirs(dir_path)
    elif not os.path.isdir(dir_path):
        logging.error(f"Path exists but is not a directory: {dir_path}")
        raise NotADirectoryError(f"Path exists but is not a directory: {dir_path}")


def dump_items():
    """Runs the Java command to dump items."""
    logging.info("Starting item dump...")
    ensure_dir_exists(ITEMS_DIR_OUTPUT) # Ensure output dir exists
    try:
        # Run the subprocess
        result = subprocess.run(items_command, capture_output=True, text=True, check=True, encoding='utf-8')
        logging.info("Item dump command finished.")
        logging.debug(f"Item dump stdout:\n{result.stdout}")
        if result.stderr:
            logging.warning(f"Item dump stderr:\n{result.stderr}")
        return True
    except FileNotFoundError:
        logging.error(f"Error: 'java' command not found. Is JRE installed in the container PATH?")
        return False
    except subprocess.CalledProcessError as e:
        logging.error(f"Item dump failed with exit code {e.returncode}.")
        logging.error(f"Command: {' '.join(e.cmd)}")
        logging.error(f"Stderr:\n{e.stderr}")
        logging.error(f"Stdout:\n{e.stdout}")
        return False
    except Exception as e:
        logging.error(f"An unexpected error occurred during item dump: {e}")
        return False

def dump_npcs():
    """Runs the Java command to dump npcs."""
    logging.info("Starting NPC dump...")
    ensure_dir_exists(NPCS_DIR_OUTPUT) # Ensure output dir exists
    try:
        result = subprocess.run(npc_command, capture_output=True, text=True, check=True, encoding='utf-8')
        logging.info("NPC dump command finished.")
        logging.debug(f"NPC dump stdout:\n{result.stdout}")
        if result.stderr:
            logging.warning(f"NPC dump stderr:\n{result.stderr}")
        return True
    except FileNotFoundError:
        logging.error(f"Error: 'java' command not found. Is JRE installed in the container PATH?")
        return False
    except subprocess.CalledProcessError as e:
        logging.error(f"NPC dump failed with exit code {e.returncode}.")
        logging.error(f"Command: {' '.join(e.cmd)}")
        logging.error(f"Stderr:\n{e.stderr}")
        logging.error(f"Stdout:\n{e.stdout}")
        return False
    except Exception as e:
        logging.error(f"An unexpected error occurred during NPC dump: {e}")
        return False

def delete_cache():
    """Deletes the cache directory *inside the container*. Be careful if it's a volume root."""
    # Warning: If CACHE_DIR_INPUT ('/app/cache') is the *root* of a volume mount
    # from the host, this will delete the contents on the HOST.
    # Only do this if the intention is truly to clean up the *source* cache.
    # If the Java process modifies the cache and you want to reset it, this might be ok.
    # If the cache on the host should remain untouched, DO NOT call this function.
    if os.path.exists(CACHE_DIR_INPUT):
        try:
            shutil.rmtree(CACHE_DIR_INPUT)
            logging.info(f"Deleted directory inside container: {CACHE_DIR_INPUT}")
        except Exception as e:
            logging.error(f"Failed to delete directory {CACHE_DIR_INPUT}: {e}")
    else:
        logging.warning(f"Directory not found, cannot delete: {CACHE_DIR_INPUT}")

# Example of how main.py might call these (ensure main.py imports dump_items, etc.)
# if __name__ == "__main__":
#     if dump_items():
#        # proceed
#        pass
#     if dump_npcs():
#        # proceed
#        pass
#     # Decide IF you really want to delete the source cache
#     # delete_cache()