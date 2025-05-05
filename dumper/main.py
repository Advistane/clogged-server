import asyncio

from db import update_db
from dumper import process_all_enum_data

if __name__ == "__main__":
    dump_data = asyncio.run(process_all_enum_data())
    update_db(dump_data)
