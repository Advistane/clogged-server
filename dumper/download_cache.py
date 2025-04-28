import os
import zipfile

import requests
import sys

# --- Configuration ---
API_ENDPOINT_URL = "https://archive.openrs2.org/caches.json"


def find_latest_oldschool_live_id(url: str) -> int | None:
    try:
        # Send GET request to the API endpoint
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        # Parse the JSON response
        data = response.json()
        print(data[0])

        # Ensure data is a list
        if not isinstance(data, list):
            print(f"Error: Expected a list from the API, but got {type(data)}", file=sys.stderr)
            return None

        # Filter the data for "oldschool" game and "live" environment
        filtered_entries = [
            entry for entry in data
            if isinstance(entry, dict)
               and entry.get("game") == "oldschool"
               and entry.get("environment") == "live"
               and entry.get("timestamp")  # Ensure timestamp exists and is not None
               and entry.get("id") is not None  # Ensure id exists and is not None
        ]

        # Check if any matching entries were found
        if not filtered_entries:
            print("No entries found matching game='oldschool' and environment='live'.", file=sys.stderr)
            return None

        # Sort the filtered entries by timestamp in descending order
        sorted_entries = sorted(
            filtered_entries,
            key=lambda x: str(x.get("timestamp", "")),  # Convert to string and use empty string as default
            reverse=True
        )

        # Return the ID of the latest entry
        return sorted_entries[0].get("id")

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from API: {e}", file=sys.stderr)
        return None
    except ValueError as e:
        print(f"Error parsing JSON response: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        return None


def download_and_get_filename(cache_id):
    print(f"Downloading cache with ID: {cache_id}")
    try:
        url = f"https://archive.openrs2.org/caches/runescape/{cache_id}/disk.zip"
        response = requests.get(url, stream=True)
        response.raise_for_status()  # Raise an exception for bad status codes

        # Extract filename from Content-Disposition header or URL
        filename = None
        if 'content-disposition' in response.headers:
            content_disposition = response.headers['content-disposition']
            filename = content_disposition.split('filename=')[-1].strip('"\'')
        else:
            filename = os.path.basename(url)

        # Ensure a full path for the file
        full_path = os.path.join("./", filename)

        with open(full_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):  # Download in chunks
                if chunk:  # Filter out keep-alive chunks
                    f.write(chunk)
        return full_path, filename  # Return both full path and filename
    except requests.exceptions.RequestException as e:
        print(f"Error downloading file: {e}")
        return None, None


def extract_zip(file_path, extract_path='.'):
    try:
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            zip_ref.extractall(extract_path)
        print(f"Successfully extracted '{file_path}' to '{extract_path}'")
        os.remove(file_path)
        print(f"Deleted zip file: '{file_path}'")
    except FileNotFoundError:
        print(f"Error: File not found: '{file_path}'")
    except zipfile.BadZipFile:
        print(f"Error: Could not open or read '{file_path}'. It may not be a valid zip file.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")


def download_and_extract_latest_cache():
    latest_id = find_latest_oldschool_live_id(API_ENDPOINT_URL)
    if latest_id is not None:
        full_path, filename = download_and_get_filename(latest_id)
        if full_path and filename:
            print(f"File downloaded successfully to {full_path}")
            print(f"Filename: {filename}")
            extract_zip(full_path)
            return True
        else:
            print("Failed to download the file.")
    else:
        print("Could not determine the latest ID.")
        return False
    return False
