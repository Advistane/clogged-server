#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

TARGET_BRANCH="${DEPLOY_BRANCH}"
COMPOSE_FILE="${COMPOSE_FILE_NAME}"
APP_PATH="${APP_DEPLOY_PATH}" # Deployment path on the server

if [ -z "$TARGET_BRANCH" ]; then
  echo "Error: DEPLOY_BRANCH environment variable not set."
  exit 1
fi
if [ -z "$COMPOSE_FILE" ]; then
  echo "Error: COMPOSE_FILE_NAME environment variable not set."
  exit 1
fi
if [ -z "$APP_PATH" ]; then
  echo "Error: APP_DEPLOY_PATH environment variable not set."
  exit 1
fi

echo "Starting deployment..."
echo "Target Branch: ${TARGET_BRANCH}"
echo "Compose File: ${COMPOSE_FILE}"
echo "Deployment Path: ${APP_PATH}"

# Navigate to the app directory (use absolute path for safety)
cd "$APP_PATH" || { echo "Failed to cd into app directory '$APP_PATH'"; exit 1; }

# Verify compose file exists here before proceeding
if [ ! -f "$COMPOSE_FILE" ]; then
     echo "Error: Compose file '$COMPOSE_FILE' not found in $(pwd)."
     exit 1
fi


echo "Pulling latest code from origin/${TARGET_BRANCH}..."
git fetch origin "${TARGET_BRANCH}"
git reset --hard origin/"${TARGET_BRANCH}"
# Ensure acme.json is OUTSIDE this directory (as per Option 1 fix)
# Add exclusions here if needed (e.g. -e node_modules/ if not gitignored)
git clean -fd

# Build images using the correct compose file
echo "Building Docker images using ${COMPOSE_FILE}..."
docker compose -f "${COMPOSE_FILE}" build # Removed --no-cache

# Cleanly stop/remove old services defined in *this specific* compose file
echo "Stopping and removing old services/volumes defined in ${COMPOSE_FILE}..."
docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans

# Start new services using the correct compose file
echo "Starting new services using ${COMPOSE_FILE}..."
docker compose -f "${COMPOSE_FILE}" up -d

# Prune unused Docker images (optional)
echo "Pruning old Docker images..."
docker image prune -f

echo "--- Deployment for branch ${TARGET_BRANCH} finished successfully! ---"