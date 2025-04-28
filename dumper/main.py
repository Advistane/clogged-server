from db import update_db

if __name__ == "__main__":
    from download_cache import download_and_extract_latest_cache
    from dump import dump_items, dump_npcs, delete_cache

    cache_download = download_and_extract_latest_cache()
    if not cache_download:
        print("Cache download failed. Exiting.")
        exit(1)
    items_result = dump_items()
    npcs_result = dump_npcs()

    if not items_result:
        print("Items dump failed.")
        exit(1)
    if not npcs_result:
        print("NPCs dump failed.")

    #delete_cache()
    print("Dump complete.")
    update_db()
