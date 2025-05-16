﻿import logging
import os
import shutil

import boto3
import requests
from botocore.exceptions import ClientError

access_key_id = os.environ.get("B2_ACCESS_KEY_ID")
secret_access_key = os.environ.get("B2_SECRET_ACCESS_KEY")
image_bucket_name = os.environ.get("B2_IMAGES_BUCKET_NAME")
endpoint = os.environ.get("B2_ENDPOINT")

def get_public_url(file_name):
    return f"https://{image_bucket_name}.{endpoint}/items/{file_name}"

def get_b2_client():
    b2_client = boto3.resource(service_name='s3',
                             endpoint_url="https://" + endpoint,  # Backblaze endpoint
                             aws_access_key_id=access_key_id,  # Backblaze keyID
                             aws_secret_access_key=secret_access_key)  # Backblaze applicationKey
    return b2_client

def check_img_exists(file_name):
    try:
        response = requests.head(get_public_url(file_name))
        return response.status_code == 200
    except requests.exceptions.RequestException:
        return False

def download_image(item_id):
    url = f"https://chisel.weirdgloop.org/static/img/osrs-sprite/{item_id}.png"
    asset_name = f"images/{item_id}.png"
    if check_img_exists(f"{item_id}.png"):
        logging.info(f"Image for item ID {item_id} already exists in B2: {asset_name}")
        return get_public_url(f"{item_id}.png")

    os.makedirs(os.path.dirname(asset_name), exist_ok=True)

    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()  # Raise an error for bad responses
        with open(asset_name, 'wb') as out_file:
            shutil.copyfileobj(response.raw, out_file)
        logging.info(f"Downloaded image for item ID {item_id} to {asset_name}")
        upload_response = upload_file("images", f"{item_id}.png", get_b2_client(), f"items/{item_id}.png")
        logging.info(f"Uploaded image for item ID {item_id} to B2: {asset_name}")
        return upload_response

    except requests.exceptions.RequestException as e:
        logging.error(f"\nError during download request: {e}")
        if os.path.exists(asset_name):  # Clean up
            os.remove(asset_name)
            logging.error(f"Removed partially downloaded file: '{asset_name}'")
    except IOError as e:
        logging.error(f"\nError writing file to disk: {e}")
        if os.path.exists(asset_name):  # Clean up
            os.remove(asset_name)
            logging.error(f"Removed partially downloaded file: '{asset_name}'")

    return None

def upload_file(directory, file, b2, b2path=None):
    file_path = directory + '/' + file
    remote_path = b2path
    if remote_path is None:
        remote_path = file
    try:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File {file_path} does not exist.")

        logging.info(f"Uploading {file} to {remote_path}")
        response = b2.Bucket(image_bucket_name).upload_file(file_path, remote_path)
        logging.info(f"Uploaded {file} to {remote_path}. {response}")
        return get_public_url(file)
    except ClientError as ce:
        print('error', ce)

    return response