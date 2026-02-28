import json
import os
import logging

from typing import Any

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

item_names_dict = {}
item_replacements = {}

def get_enum_data(enum_id: int) -> list[tuple[Any, Any]]:
    file_path = os.path.join('dump', 'enums', f'{enum_id}.json')
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            data = json.load(file)
            return list(zip(data['keys'], data['intVals']))
    except FileNotFoundError:
        logging.error(f"Error: File not found at {file_path}")
        return []
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding JSON from {file_path}: {e}")
        return []
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")
        return []

def get_struct_data(struct_id: int) -> dict:
    file_path = os.path.join('dump', 'structs', f'{struct_id}.json')
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            data = json.load(file)
            params = data.get('params', {})
            name = params.get('689')
            items_enum = params.get('690')
            return {
                'name': name,
                'items_enum': items_enum
            }
    except FileNotFoundError:
        logging.error(f"Error: File not found at {file_path}")
        return {}
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding JSON from {file_path}: {e}")
        return {}
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")
        return {}

def populate_item_replacements():
    mappings = get_enum_data(3721)
    if mappings:
        for (key, val) in mappings:
            if key is not None and val is not None:
                item_replacements[key] = val

    return item_replacements

def process_all_enums():
    result = []
    for enum in enums:
        logging.debug(f"Processing Enum ID: {enum['id']}, Name: {enum['name']}, Category ID: {enum['category_id']}")
        result.extend(process_enum(enum, category_id=enum['category_id']))
    return result


def process_enum(enum: dict, category_id: int):
    enum_id = enum['id']
    data = get_enum_data(enum_id)
    if not data:
        logging.warning(f"No data found for Enum ID: {enum_id}")
        return []

    result = []
    for index, struct_id in data:
        struct_result = process_struct(struct_id, category_id)
        if struct_result:
            result.append(struct_result)
    return result


def process_struct(struct_id: int, category_id: int):
    struct_data = get_struct_data(struct_id)
    if not struct_data:
        logging.warning(f"No data found for struct ID: {struct_id}")
        return None

    subcategory_name = struct_data.get('name')
    items_enum = struct_data.get('items_enum')
    if not items_enum:
        logging.warning(f"No items enum found for struct ID: {struct_id}")
        return None

    return process_items(subcategory_name, struct_id, items_enum, category_id)


def process_items(subcategory_name: str, subcategory_id: int, items_enum: int, category_id: int):
    items = get_enum_data(items_enum)
    item_ids = [x[1] for x in items]
    final_items = []

    for i, item_id in enumerate(item_ids):
        item_name = item_names_dict.get(item_id, None)
        final_item_id = item_replacements.get(item_id, item_id)
        if item_id in item_replacements:
            logging.debug(f"Replaced item ID {item_id} with {final_item_id}")

        final_item = {
            "itemId": final_item_id,
            "itemName": item_name if item_name else None,
            "originalItemId": item_id,
            "displayorder": i + 1
        }
        final_items.append(final_item)

    return {
        "subcategoryName": subcategory_name,
        "subcategoryId": subcategory_id,
        "items": final_items,
        "categoryId": category_id
    }

def populate_item_dict() -> dict:
    api_endpoint_url = "https://raw.githubusercontent.com/runelite/static.runelite.net/refs/heads/gh-pages/cache/item/names.json"

    try:
        response = requests.get(api_endpoint_url, timeout=30)
        response.raise_for_status()
        json_data = response.json()
        for item_id, item_name in json_data.items():
            item_names_dict[int(item_id)] = item_name

        logging.info(f"Item names dictionary populated with {len(item_names_dict)} items.")

    except requests.exceptions.HTTPError as e:
        logging.error(f"HTTP error occurred: {e} - Status code: {response.status_code}")
    except requests.exceptions.ConnectionError as e:
        logging.error(f"Connection error occurred: {e} - Check your internet connection or the URL.")
    except requests.exceptions.Timeout as e:
        logging.error(f"Request timed out: {e}")
    except requests.exceptions.RequestException as e:
        logging.error(f"An error occurred during the request: {e}")
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding JSON response: {e}")
        logging.error(f"Response content: {response.text[:200]}...") # Print first 200 chars for debugging
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")

    return item_names_dict