import logging

from db import update_db
from download_cache import download_latest_cache, extract_specific_folders_tarfile, delete_files
from dump import populate_item_replacements, process_all_enums, populate_item_dict

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("Dumper starting...")

    asset_name = download_latest_cache()
    if not asset_name:
        logging.error("Failed to download the latest cache.")
        exit(1)

    extract_specific_folders_tarfile(asset_name, '.', ['dump/enums', 'dump/structs'])

    populate_item_replacements()
    populate_item_dict()

    dump = process_all_enums()
    logging.info(f"Processed {len(dump)} subcategories from cache")
    update_db(dump)
    delete_files()
