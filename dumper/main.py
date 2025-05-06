import logging

from db import update_db
from download_cache import download_latest_cache, extract_specific_folders_tarfile, delete_files
from dump import populate_item_replacements, process_all_enums

if __name__ == "__main__":
    asset_name = download_latest_cache()
    if asset_name:
        logging.info(f"Downloaded cache: {asset_name}")
        extract_specific_folders_tarfile(asset_name, '.', ['dump/enums', 'dump/structs'])
    else:
        logging.error("Failed to download the latest cache.")
        exit(1)

    populate_item_replacements()
    dump = process_all_enums()
    logging.info(f"Processed {len(dump)} enums.")
    update_db(dump)
    delete_files()