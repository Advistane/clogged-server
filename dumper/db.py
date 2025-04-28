import json
import logging
import os
import psycopg2
from pathlib import Path

from psycopg2.extras import execute_values

DB_NAME = os.environ.get("DB_NAME", "clogged")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "postgres")
DB_HOST = os.environ.get("DB_HOST", "db")
DB_PORT = os.environ.get("DB_PORT", "5432")

DB_CONFIG = {
    "dbname": DB_NAME,
    "user": DB_USER,
    "password": DB_PASSWORD,
    "host": DB_HOST,
    "port": DB_PORT
}

SCRIPT_DIR = Path(__file__).parent.resolve() # This will be /app in the container
SOURCE_DIRS = {
    "items": SCRIPT_DIR / "items",
    "npcs": SCRIPT_DIR / "npcs"
}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def connect_db():
    """Establishes a connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        logging.info("Successfully connected to the database.")
        return conn
    except psycopg2.OperationalError as e:
        logging.error(f"Database connection failed: {e}")
        return None

def process_json_files(directory_path: Path):
    """
    Reads all JSON files in a directory, extracts 'id' and 'name'.

    Args:
        directory_path: The Path object pointing to the directory.

    Yields:
        A tuple (id, name) for each valid JSON file found.
    """
    if not directory_path.is_dir():
        logging.warning(f"Directory not found: {directory_path}")
        return

    logging.info(f"Processing files in: {directory_path}")
    file_count = 0
    processed_count = 0
    for file_path in directory_path.glob('*.json'):
        file_count += 1
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'id' in data and 'name' in data:
                    yield str(data['id']), data['name']  # Ensure ID is string if DB expects varchar
                    processed_count += 1
                else:
                    logging.warning(f"Skipping {file_path.name}: Missing 'id' or 'name' key.")
        except json.JSONDecodeError:
            logging.error(f"Skipping {file_path.name}: Invalid JSON format.")
        except Exception as e:
            logging.error(f"Skipping {file_path.name}: Unexpected error - {e}")

    logging.info(f"Found {file_count} files, successfully processed {processed_count} for ID/Name.")


def upsert_data(conn, table_name: str, data_iterator):
    """
    Inserts or updates data into the specified table using ON CONFLICT.

    Args:
        conn: Active psycopg2 database connection.
        table_name: The name of the target table ('items' or 'npcs').
        data_iterator: An iterator yielding tuples of (id, name).
    """
    data_list = list(data_iterator) # Convert iterator to list for execute_values
    if not data_list:
        logging.info(f"No data to insert/update for table '{table_name}'.")
        return

    # Use ON CONFLICT (id) DO UPDATE to insert new rows or update existing ones
    # Assumes 'id' is the PRIMARY KEY or has a UNIQUE constraint
    # 'EXCLUDED' refers to the values proposed for insertion.
    sql = f"""
        INSERT INTO {table_name} (id, name)
        VALUES %s
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name;
    """

    try:
        with conn.cursor() as cur:
            execute_values(cur, sql, data_list, page_size=100) # page_size for batching
            conn.commit()
            logging.info(f"Successfully upserted {len(data_list)} records into '{table_name}'.")
    except psycopg2.Error as e:
        logging.error(f"Database error during upsert into '{table_name}': {e}")
        conn.rollback() # Roll back the transaction on error
    except Exception as e:
        logging.error(f"Unexpected error during upsert into '{table_name}': {e}")
        conn.rollback()


def update_db():
    logging.info("Starting data loading process...")
    conn = connect_db()

    if conn:
        try:
            for table_name, dir_path in SOURCE_DIRS.items():
                logging.info(f"--- Processing table: {table_name} ---")
                data_to_insert = process_json_files(dir_path)
                upsert_data(conn, table_name, data_to_insert)
                logging.info(f"--- Finished processing table: {table_name} ---")
        finally:
            conn.close()
            logging.info("Database connection closed.")
    else:
        logging.error("Could not establish database connection. Exiting.")

    logging.info("Data loading process finished.")