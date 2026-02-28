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
        logging.debug("Successfully connected to the database.")
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
            logging.debug("Upserted categories.")
    except psycopg2.Error as e:
        logging.error(f"Database error during upsert of categories: {e}")
        conn.rollback()

def upsert_subcategory(conn, subcategory_id: int, subcategory_name: str, category_id: int, total: int):
    sql = """
        INSERT INTO subcategories (id, name, categoryid, total)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, categoryid = EXCLUDED.categoryid, total = EXCLUDED.total
        WHERE subcategories.name != EXCLUDED.name
           OR subcategories.categoryid != EXCLUDED.categoryid
           OR subcategories.total != EXCLUDED.total
        RETURNING id;
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (subcategory_id, subcategory_name, category_id, total))
            changed = cur.fetchone() is not None
            conn.commit()
            if changed:
                logging.info(f"Subcategory updated: {subcategory_name} (id={subcategory_id})")
            else:
                logging.debug(f"Subcategory unchanged: {subcategory_name} (id={subcategory_id})")
            return changed
    except psycopg2.Error as e:
        logging.error(f"Database error during upsert of subcategory {subcategory_id}: {e}")
        conn.rollback()
        return False


def upsert_subcategory_items(conn, subcategory_id: int, subcategory_name: str, items: list):
    sql_insert = """
                 INSERT INTO subcategory_items (subcategoryid, itemid, itemname, originalitemid, displayorder)
                 VALUES %s
                ON CONFLICT (subcategoryid, itemid)
                 DO UPDATE SET originalitemid = EXCLUDED.originalitemid, itemname = EXCLUDED.itemname, displayorder = EXCLUDED.displayorder;
                 """

    sql_check = """
                SELECT originalitemid
                FROM subcategory_items
                WHERE subcategoryid = %s
                  AND (image_url IS NULL OR image_url = '');
                """

    changes = {"added_or_updated": 0, "removed": 0, "images_downloaded": 0}

    try:
        with conn.cursor() as cur:
            # Count existing items before changes
            cur.execute("SELECT COUNT(*) FROM subcategory_items WHERE subcategoryid = %s;", (subcategory_id,))
            existing_count = cur.fetchone()[0]

            item_ids_to_keep = [item["itemId"] for item in items]

            if not item_ids_to_keep:
                if existing_count > 0:
                    cur.execute("DELETE FROM subcategory_items WHERE subcategoryid = %s;", (subcategory_id,))
                    changes["removed"] = existing_count
            else:
                # Delete items not in the new list
                sql_delete_old = "DELETE FROM subcategory_items WHERE subcategoryid = %s AND itemid NOT IN %s;"
                cur.execute(sql_delete_old, (subcategory_id, tuple(item_ids_to_keep)))
                changes["removed"] = cur.rowcount

            if items:
                execute_values(cur, sql_insert, [
                    (subcategory_id, item["itemId"], item["itemName"], item["originalItemId"], item["displayorder"]) for
                    item in items
                ])
                changes["added_or_updated"] = len(items) - (existing_count - changes["removed"])

            conn.commit()

            # Check for missing images
            cur.execute(sql_check, (subcategory_id,))
            missing_image_items = cur.fetchall()

            if missing_image_items:
                for item in missing_image_items:
                    item_id = item[0]
                    logging.info(f"Downloading missing image for item {item_id} in {subcategory_name}")
                    public_url = download_image(item_id)
                    if public_url:
                        update_sql = """
                            UPDATE subcategory_items
                            SET image_url = %s
                            WHERE subcategoryid = %s AND originalitemid = %s;
                        """
                        cur.execute(update_sql, (public_url, subcategory_id, item_id))
                        changes["images_downloaded"] += 1

            conn.commit()

            # Update total
            update_total_sql = """
                               UPDATE subcategories
                               SET total = (SELECT COUNT(*)
                                            FROM subcategory_items
                                            WHERE subcategoryid = %s)
                               WHERE id = %s;
                               """
            cur.execute(update_total_sql, (subcategory_id, subcategory_id))
            conn.commit()

    except psycopg2.Error as e:
        logging.error(f"Database error during upsert of items for subcategory {subcategory_name} ({subcategory_id}): {e}")
        conn.rollback()
        return changes

    # Only log at INFO if something actually changed
    has_changes = changes["removed"] > 0 or changes["added_or_updated"] > 0 or changes["images_downloaded"] > 0
    if has_changes:
        parts = []
        if changes["added_or_updated"] > 0:
            parts.append(f"{changes['added_or_updated']} items added/updated")
        if changes["removed"] > 0:
            parts.append(f"{changes['removed']} items removed")
        if changes["images_downloaded"] > 0:
            parts.append(f"{changes['images_downloaded']} images downloaded")
        logging.info(f"{subcategory_name}: {', '.join(parts)}")
    else:
        logging.debug(f"{subcategory_name}: no changes")

    return changes

def update_db(data_dump: list):
    conn = connect_db()

    if not conn:
        logging.error("Could not establish database connection. Exiting.")
        return

    total_changes = {"subcategories_changed": 0, "items_added_or_updated": 0, "items_removed": 0, "images_downloaded": 0}

    try:
        upsert_categories(conn)
        for data in data_dump:
            name = data["subcategoryName"]
            items = data["items"]
            subcategory_id = data["subcategoryId"]
            category_id = data["categoryId"]

            sub_changed = upsert_subcategory(conn, subcategory_id, name, category_id, len(items))
            if sub_changed:
                total_changes["subcategories_changed"] += 1

            item_changes = upsert_subcategory_items(conn, subcategory_id, name, items)
            total_changes["items_added_or_updated"] += item_changes.get("added_or_updated", 0)
            total_changes["items_removed"] += item_changes.get("removed", 0)
            total_changes["images_downloaded"] += item_changes.get("images_downloaded", 0)
    finally:
        conn.close()

    # Final summary
    has_any_changes = any(v > 0 for v in total_changes.values())
    if has_any_changes:
        logging.info(
            f"Dumper complete: {total_changes['subcategories_changed']} subcategories changed, "
            f"{total_changes['items_added_or_updated']} items added/updated, "
            f"{total_changes['items_removed']} items removed, "
            f"{total_changes['images_downloaded']} images downloaded"
        )
    else:
        logging.info("Dumper complete: no changes detected")
