import asyncio
from typing import Any

import aiohttp
import requests

enums = [
    {
        "id": 2103,
        "name": "Bosses",
        "category_id": 1
    },
    {
        "id": 2104,
        "name": "Raids",
        "category_id": 2
    },
    {
        "id": 2105,
        "name": "Clues",
        "category_id": 3
    },
    {
        "id": 2106,
        "name": "Minigames",
        "category_id": 4
    },
    {
        "id": 2107,
        "name": "Other",
        "category_id": 5
    },
]

async def fetch_json(session: aiohttp.ClientSession, url: str) -> dict:
    try:
        async with session.get(url) as response:
            response.raise_for_status()
            return await response.json()
    except aiohttp.ClientError as e:
        print(f"Error fetching data from {url}: {e}")
        return {}


def get_enum_data(enum_id) -> dict:
    enum_url = "https://chisel.weirdgloop.org/structs/enums/{}.json".format(enum_id)
    try:
        response = requests.get(enum_url)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"Error fetching boss enum data: {e}")
        return {}

async def lookup_item_enum(session: aiohttp.ClientSession, enum_id: int) -> list[Any]:
    lookup_url = f"https://chisel.weirdgloop.org/structs/enums/{enum_id}.json"
    items = []
    data = await fetch_json(session, lookup_url)
    for entry in data.get("rows", []):
        item_id = entry.get("raw_val")
        item_name = entry.get("parsed_val", {}).get("text")
        if item_id is not None and item_name is not None:
            items.append({"id": item_id, "name": item_name})
    return items

async def lookup_subcategory_struct(session: aiohttp.ClientSession, struct_id: int, category_id: int) -> str | dict[str, list[Any] | Any]:
    lookup_url = f"https://chisel.weirdgloop.org/structs/structs/{struct_id}.json"
    data = await fetch_json(session, lookup_url)
    try:
        subcategory_name = data["rows"][0].get("raw_val")
        subcategory_item_enum = data["rows"][1].get("raw_val", None)
        subcategory_items = await lookup_item_enum(session, subcategory_item_enum) if subcategory_item_enum else []
        return {"name": subcategory_name, "items": subcategory_items, "subcategory_id": struct_id, "category_id": category_id}
    except (IndexError, KeyError) as e:
        print(f"Error processing struct data for ID {struct_id}: {e}")
        return "Unknown"

async def process_all_enum_data() -> list[Any]:
    async with aiohttp.ClientSession() as session:
        tasks = []
        for enum in enums:
            print(f"Processing {enum['name']}")
            enum_id = enum.get("id")
            category_id = enum.get("category_id")
            data = await fetch_json(session, f"https://chisel.weirdgloop.org/structs/enums/{enum_id}.json")
            for entry in data.get("rows", []):
                subcategory_id = entry.get("raw_val")
                if subcategory_id is not None:
                    tasks.append(lookup_subcategory_struct(session, subcategory_id, category_id))
            print(f"Processed {enum['name']}")

        return await asyncio.gather(*tasks)
