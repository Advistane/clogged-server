import logging
import os
import shutil
import tarfile

import requests

# --- Configuration ---
GITHUB_RELEASE_ENDPOINT = "https://api.github.com/repos/abextm/osrs-cache/releases/latest"

def download_latest_cache():
    try:
        logging.info(f"Fetching latest release information from {GITHUB_RELEASE_ENDPOINT}...")
        response = requests.get(GITHUB_RELEASE_ENDPOINT, timeout=30)
        response.raise_for_status()  # Raise an exception for HTTP errors (4xx or 5xx)
    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            logging.error(f"Error: Repository or latest release not found for osrs-cache. "
                  f"Please check the repository path and ensure it has releases.")
        elif response.status_code == 403:
            logging.error(f"Error: Forbidden (403). This could be due to rate limiting or "
                  f"the repository being private without authentication. "
                  f"Details: {e.response.text}")
        else:
            logging.error(f"Error fetching release information: {e}")
        return None
    except requests.exceptions.RequestException as e:
        logging.error(f"Error connecting to GitHub API: {e}")
        return None

    release_data = response.json()
    assets = release_data.get("assets", [])

    if not assets:
        logging.error(f"No assets found in the latest release for osrs-cache.")
        return None

    target_asset = assets[0]
    if not target_asset:
        logging.error("No assets found in the latest release.")
        return None

    asset_name = target_asset["name"]
    download_url = target_asset["browser_download_url"]

    logging.info(f"Downloading from: {download_url}")

    try:
        with requests.get(download_url, stream=True, timeout=120) as r:
            r.raise_for_status()
            total_size = int(r.headers.get('content-length', 0))
            downloaded_size = 0
            chunk_size = 8192  # 8KB

            with open(asset_name, "wb") as f:
                for chunk in r.iter_content(chunk_size=chunk_size):
                    f.write(chunk)
                    downloaded_size += len(chunk)
                    if total_size > 0:
                        progress = (downloaded_size / total_size) * 100
                        logging.debug(f"\rDownloading '{asset_name}'... {progress:.2f}% complete", end="")
                    else:
                        logging.info(f"\rDownloading '{asset_name}'... {downloaded_size / (1024 * 1024):.2f} MB downloaded",
                              end="")
            logging.info(f"\nDownload complete: '{asset_name}' saved to current directory.")
            return asset_name
    except requests.exceptions.HTTPError as e:
        logging.error(f"\nError downloading file: {e}")
        if os.path.exists(asset_name):  # Clean up partially downloaded file
            os.remove(asset_name)
            logging.error(f"Removed partially downloaded file: '{asset_name}'")
    except requests.exceptions.RequestException as e:
        logging.error(f"\nError during download request: {e}")
        if os.path.exists(asset_name):  # Clean up
            os.remove(asset_name)
            logging.error(f"Removed partially downloaded file: '{asset_name}'")
    except IOError as e:
        logging.error(f"\nError writing file to disk: {e}")
        if os.path.exists(asset_name):  # Clean up
            os.remove(asset_name)
            logging.error(f"Removed partially downloaded file: '{asset_name}'")

    return None

def extract_specific_folders_tarfile(file_path, extract_path, folders_to_extract):
    os.makedirs(extract_path, exist_ok=True)
    extracted_something = False
    with tarfile.open(file_path, 'r:gz') as tar:
        members_to_extract = []
        for member in tar.getmembers():
            for folder_name in folders_to_extract:
                if member.name == folder_name or \
                   member.name.startswith(folder_name.rstrip('/') + '/'):
                    members_to_extract.append(member)
                    break

        if members_to_extract:
            logging.info(f"Extracting selected members to {extract_path}...")
            tar.extractall(path=extract_path, members=members_to_extract)
            extracted_something = True
            logging.info("Extraction of specific folders complete.")
        else:
            logging.error(f"No members found matching {folders_to_extract} in the archive.")

    return extracted_something

def delete_files():
    # Delete the "dump" directory if it exists
    if os.path.isdir('dump'):
        try:
            shutil.rmtree('dump')
            logging.info("Deleted directory: dump")
        except Exception as e:
            logging.error(f"Error deleting directory 'dump': {e}")

    if os.path.isdir('images'):
        try:
            shutil.rmtree('images')
            logging.info("Deleted directory: images")
        except Exception as e:
            logging.error(f"Error deleting directory 'images': {e}")

    # Delete all files in the current directory
    for filename in os.listdir('.'):
        if filename.endswith('.tar.gz'):
            try:
                os.remove(filename)
                logging.info(f"Deleted file: {filename}")
                break
            except Exception as e:
                logging.error(f"Error deleting file {filename}: {e}")

