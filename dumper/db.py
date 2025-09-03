import logging
import os
import psycopg2

from psycopg2.extras import execute_values

from images import download_image

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

def upsert_subcategory(conn, subcategory_id: int, subcategory_name: str, category_id: int, total: int):
    sql = """
        INSERT INTO subcategories (id, name, categoryid, total)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING ;
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (subcategory_id, subcategory_name, category_id, total))
            conn.commit()
            logging.info(f"Upserted subcategory {subcategory_id}: {subcategory_name}")
    except psycopg2.Error as e:
        logging.error(f"Database error during upsert of subcategory {subcategory_id}: {e}")
        conn.rollback() # Roll back the transaction on error


def upsert_subcategory_items(conn, subcategory_id: int, items: list):
    logging.info(f"Upserting items for subcategory {subcategory_id}: {items}")
    sql_insert = """
                 INSERT INTO subcategory_items (subcategoryid, itemid, itemname, originalitemid, displayorder)
                 VALUES %s
                ON CONFLICT (subcategoryid, itemid) \
                 DO UPDATE SET originalitemid = EXCLUDED.originalitemid, itemname = EXCLUDED.itemname, displayorder = EXCLUDED.displayorder;
                 """

    sql_check = """
                SELECT originalitemid \
                FROM subcategory_items
                WHERE subcategoryid = %s \
                  AND (image_url IS NULL OR image_url = ''); \
                """
    try:
        with conn.cursor() as cur:

            item_ids_to_keep = [item["itemId"] for item in items]

            if not item_ids_to_keep:
                # If the incoming list is empty, delete all items for the subcategory.
                sql_delete_all = "DELETE FROM subcategory_items WHERE subcategoryid = %s;"
                cur.execute(sql_delete_all, (subcategory_id,))
                logging.info(f"All items for subcategory {subcategory_id} deleted as the provided item list was empty.")
            else:
                # Delete items that are in the DB but not in our list of items to keep.
                sql_delete_old = "DELETE FROM subcategory_items WHERE subcategoryid = %s AND itemid NOT IN %s;"
                cur.execute(sql_delete_old, (subcategory_id, tuple(item_ids_to_keep)))
                logging.info(f"Deleted old items for subcategory {subcategory_id} that are not in the new list.")

            # Insert items
            #execute_values(cur, sql_insert, [(subcategory_id, item["itemId"], item["itemName"], item["originalItemId"], item["displayorder"]) for item in items])
            if items:
                execute_values(cur, sql_insert, [
                    (subcategory_id, item["itemId"], item["itemName"], item["originalItemId"], item["displayorder"]) for
                    item in items
                ])

                logging.info(f"Upserted items for subcategory {subcategory_id}")
            conn.commit()

            # Check for empty or NULL image_url
            cur.execute(sql_check, (subcategory_id,))
            missing_image_items = cur.fetchall()

            if missing_image_items:
                for item in missing_image_items:
                    item_id = item[0]
                    logging.info(f"Item {item_id} has no image_url. Downloading image...")
                    public_url = download_image(item_id)
                    if public_url:
                        update_sql = """
                            UPDATE subcategory_items
                            SET image_url = %s
                            WHERE subcategoryid = %s AND originalitemid = %s;
                        """
                        cur.execute(update_sql, (public_url, subcategory_id, item_id))
                        logging.info(f"Item {item_id} has been updated with image_url: {public_url}")

                print(f"Items with missing image_url: {missing_image_items}")
                # Do something with these items (e.g., update image_url or log them)

            conn.commit()
            logging.info(f"Upserted items for subcategory {subcategory_id}")

            update_total_sql = """
                               UPDATE subcategories
                               SET total = (SELECT COUNT(*) \
                                            FROM subcategory_items \
                                            WHERE subcategoryid = %s)
                               WHERE id = %s; \
                               """
            cur.execute(update_total_sql, (subcategory_id, subcategory_id))
            conn.commit()
            logging.info(f"Updated total for subcategory {subcategory_id}")

    except psycopg2.Error as e:
        logging.error(f"Database error during upsert of items for subcategory {subcategory_id}: {e}")
        conn.rollback()  # Roll back the transaction on error

def update_db(data_dump: list):
    logging.info("Starting data loading process...")
    conn = connect_db()

    if conn:
        try:
            upsert_categories(conn)
            for data in data_dump:
                name = data["subcategoryName"]
                items = data["items"]
                subcategory_id = data["subcategoryId"]
                category_id = data["categoryId"]

                logging.info(f"Processing {name} with ID {subcategory_id}")
                upsert_subcategory(conn, subcategory_id, name, category_id, len(items))
                upsert_subcategory_items(conn, subcategory_id, items)
        finally:
            conn.close()
            logging.info("Database connection closed.")
    else:
        logging.error("Could not establish database connection. Exiting.")

    logging.info("Data loading process finished.")