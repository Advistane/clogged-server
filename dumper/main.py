import logging

from db import update_db
from download_cache import download_latest_cache, extract_specific_folders_tarfile, delete_files
from dump import populate_item_replacements, process_all_enums, populate_item_dict

if __name__ == "__main__":
    asset_name = download_latest_cache()
    if asset_name:
        logging.info(f"Downloaded cache: {asset_name}")
        extract_specific_folders_tarfile(asset_name, '.', ['dump/enums', 'dump/structs'])
    else:
        logging.error("Failed to download the latest cache.")
        exit(1)

    logging.info("Populating item replacements...")
    populate_item_replacements()
    logging.info("Item replacements populated.")
    logging.info("Populating item dictionary...")
    populate_item_dict()
    logging.info("Populated item dictionary.")

    dump = process_all_enums()
    logging.info(f"Processed {len(dump)} enums.")
    update_db(dump)
    delete_files()