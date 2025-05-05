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
echo "Grafana root URL: ${GF_SERVER_ROOT_URL}"
export B2_ACCESS_KEY_ID
export B2_SECRET_ACCESS_KEY
export B2_ENDPOINT # Make sure these are also passed/exported if needed
export B2_BUCKET_NAME
export B2_REGION
export GF_SECURITY_ADMIN_USER # Pass relevant Grafana/Traefik vars too
export GF_SECURITY_ADMIN_PASSWORD
export GF_SERVER_ROOT_URL
export ACME_EMAIL

cd "$APP_PATH" || { echo "Failed to cd into app directory '$APP_PATH'"; exit 1; }

if [ ! -f "$COMPOSE_FILE" ]; then
     echo "Error: Compose file '$COMPOSE_FILE' not found in $(pwd)."
     exit 1
fi


echo "Pulling latest code from origin/${TARGET_BRANCH}..."
git fetch origin "${TARGET_BRANCH}"
git reset --hard origin/"${TARGET_BRANCH}"
git clean -fd

# --- Run Database Migrations ---
echo "Running database migrations..."
echo "APP_DB_USER = ${APP_DB_USER}"

echo "--- DEBUG: Checking filesystem and context inside migration container ---"
docker compose -f "${COMPOSE_FILE}" run --rm \
  -e PGHOST="db" \
  -e PGPORT=5432 \
  -e PGDATABASE="${POSTGRES_DB}" \
  -e PGUSER="${APP_DB_USER}" \
  -e PGPASSWORD="${APP_DB_PASSWORD}" \
  server sh -c 'echo "*** Inside Container ***"; \
                echo "Running as user: $(whoami)"; \
                echo "Current directory: $(pwd)"; \
                echo "--- Listing /app/server: ---"; \
                ls -la /app/server; \
                echo "--- Listing /app/server/migrations (if exists): ---"; \
                ls -la /app/server/migrations; \
                echo "*** End Inside Container ***"'

echo "DEBUG: Filesystem check finished. Stopping script for debugging."
exit 1 # Stop the script here during debugging


# Use 'run --rm' to start a temporary container based on the 'server' service definition
# Pass the necessary PG* environment variables mapped from your DB* variables
docker compose -f "${COMPOSE_FILE}" run --rm \
  -e PGHOST="db" \
  -e PGPORT=5432 \
  -e PGDATABASE="${POSTGRES_DB}" \
  -e PGUSER="${POSTGRES_USER}" \
  -e PGPASSWORD="${POSTGRES_PASSWORD}" \
  server npm run migrate:up

echo "Building Docker images using ${COMPOSE_FILE}..."
docker compose -f "${COMPOSE_FILE}" build

docker compose -f "${COMPOSE_FILE}" down --remove-orphans

# Start new services using the correct compose file
echo "Starting new services using ${COMPOSE_FILE}..."
docker compose -f "${COMPOSE_FILE}" up -d

# Prune unused Docker images (optional)
echo "Pruning old Docker images..."
docker image prune -f

echo "--- Deployment for branch ${TARGET_BRANCH} finished successfully! ---"