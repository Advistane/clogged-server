# dumper/Dockerfile.dev

# Use an official Python runtime as a parent image
FROM python:3.13

RUN apt-get update && \
    apt-get install -y --no-install-recommends openjdk-17-jre-headless && \
    # Clean up APT cache to keep image size down
    rm -rf /var/lib/apt/lists/* \

# Set the working directory in the container
WORKDIR /app/dumper

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
# --no-cache-dir keeps the image size smaller
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container at /app
# This includes main.py and potentially the items/npcs subdirs if needed at build time
# BUT: It's usually better to mount the data directories (items/npcs) as volumes
COPY . .

# Command to run when the container starts
# This will execute the script once and then the container will exit
CMD ["python", "main.py"]