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

def upsert_categories(conn):
    sql = """
        INSERT INTO categories (id, name)
        VALUES (%s, %s)
        ON CONFLICT (id) DO NOTHING;
    """
    try:
        with conn.cursor() as cur:
            for category_id, category_name in enumerate(["Bosses", "Raids", "Clues", "Minigames", "Other"], start=1):
                cur.execute(sql, (category_id, category_name))
            conn.commit()
            logging.info("Upserted categories.")
    except psycopg2.Error as e:
        logging.error(f"Database error during upsert of categories: {e}")
        conn.rollback() # Roll back the transaction on error

def upsert_subcategory(conn, subcategory_id: int, subcategory_name: str, category_id: int):
    sql = """
        INSERT INTO subcategories (id, name, categoryid)
        VALUES (%s, %s, %s)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name;
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (subcategory_id, subcategory_name, category_id))
            conn.commit()
            logging.info(f"Upserted subcategory {subcategory_id}: {subcategory_name}")
    except psycopg2.Error as e:
        logging.error(f"Database error during upsert of subcategory {subcategory_id}: {e}")
        conn.rollback() # Roll back the transaction on error

def upsert_subcategory_items(conn, subcategory_id: int, items: list):
    print(items)
    sql = """
        INSERT INTO subcategory_items (subcategoryid, itemid, itemname)
        VALUES %s
        ON CONFLICT (subcategoryid, itemid) DO NOTHING;
    """
    try:
        with conn.cursor() as cur:
            execute_values(cur, sql, [(subcategory_id, item["id"], item["name"]) for item in items])
            conn.commit()
            logging.info(f"Upserted items for subcategory {subcategory_id}")
    except psycopg2.Error as e:
        logging.error(f"Database error during upsert of items for subcategory {subcategory_id}: {e}")
        conn.rollback() # Roll back the transaction on error

def update_db(data_dump: list):
    logging.info("Starting data loading process...")
    conn = connect_db()

    if conn:
        try:
            upsert_categories(conn)
            for data in data_dump:
                name = data["name"]
                items = data["items"]
                subcategory_id = data["subcategory_id"]
                category_id = data["category_id"]

                logging.info(f"Processing {name} with ID {subcategory_id}")
                upsert_subcategory(conn, subcategory_id, name, category_id)
                upsert_subcategory_items(conn, subcategory_id, items)
        finally:
            conn.close()
            logging.info("Database connection closed.")
    else:
        logging.error("Could not establish database connection. Exiting.")

    logging.info("Data loading process finished.")