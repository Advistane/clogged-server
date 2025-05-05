#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# --- Validate Required Variables ---
required_vars=(
    DEPLOY_BRANCH COMPOSE_FILE_NAME APP_DEPLOY_PATH
    DB_IMAGE_NAME SERVER_IMAGE_NAME DATA_LOADER_IMAGE_NAME WORKER_IMAGE_NAME
    GHCR_USER GHCR_TOKEN
    ACME_EMAIL POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
    APP_DB_USER APP_DB_PASSWORD ENDPOINT_SECRET_KEY APP_HOSTNAME GRAFANA_HOSTNAME
    B2_ACCESS_KEY_ID B2_SECRET_ACCESS_KEY B2_BUCKET_NAME B2_ENDPOINT B2_REGION
    GF_SECURITY_ADMIN_USER GF_SECURITY_ADMIN_PASSWORD GF_SERVER_ROOT_URL
)
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "Error: Environment variable '$var' is not set."
        exit 1
    fi
done

echo "--- DEBUG: Checking critical variables before compose up ---"
echo "GRAFANA_HOSTNAME='${GRAFANA_HOSTNAME}'" # Check if set and correct
echo "APP_HOSTNAME='${APP_HOSTNAME}'"
echo "ACME_EMAIL='${ACME_EMAIL}'"
echo "GF_SERVER_ROOT_URL='${GF_SERVER_ROOT_URL}'"
# Add any other essential vars used in docker-compose.yml
echo "--- END DEBUG ---"

echo "Starting deployment..."
echo "Target Branch: ${DEPLOY_BRANCH}"
echo "Compose File: ${COMPOSE_FILE_NAME}"
echo "Deployment Path: ${APP_DEPLOY_PATH}"
echo "Server Image: ${SERVER_IMAGE_NAME}" # Example logging

# --- Navigate to App Directory ---
cd "$APP_DEPLOY_PATH" || { echo "Failed to cd into app directory '$APP_DEPLOY_PATH'"; exit 1; }

if [ ! -f "$COMPOSE_FILE_NAME" ]; then
     echo "Error: Compose file '$COMPOSE_FILE_NAME' not found in $(pwd)."
     exit 1
fi

# --- Update Code (Optional but good practice) ---
# If your deploy.sh script itself or other config files (like loki/promtail)
# are part of the repo, you still need to pull them.
echo "Pulling latest configuration files from origin/${DEPLOY_BRANCH}..."
# Stash local changes if any, fetch, reset, clean
# Be CAREFUL if you have manually modified files on the server you want to keep
# git stash push -m "Pre-deploy stash $(date)" || true # Stash uncommitted changes
git fetch origin "${DEPLOY_BRANCH}"
git reset --hard origin/"${DEPLOY_BRANCH}"
git clean -fd # Remove untracked files/dirs

# --- Log in to GitHub Container Registry ---
echo "Logging in to GitHub Container Registry (ghcr.io)..."
echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin

# --- Pull latest images specified in compose file ---
echo "Pulling Docker images from GHCR using ${COMPOSE_FILE_NAME}..."
# docker-compose will use the *_IMAGE_NAME env vars defined in the file
docker compose -f "${COMPOSE_FILE_NAME}" pull

# --- Stop and remove old containers ---
echo "Stopping and removing existing services..."
# Use --remove-orphans to clean up containers from services removed from the compose file
docker compose -f "${COMPOSE_FILE_NAME}" down --remove-orphans

# --- Build step is REMOVED ---
# echo "Building Docker images using ${COMPOSE_FILE_NAME} (no cache)..." # REMOVED
# docker compose -f "${COMPOSE_FILE_NAME}" build --no-cache            # REMOVED

# --- Start new services ---
echo "Starting new services using ${COMPOSE_FILE_NAME}..."
# docker-compose will use the images pulled previously
docker compose -f "${COMPOSE_FILE_NAME}" up -d

# --- Run Database Migrations ---
# Check if the server service exists before trying to run migrations
if docker compose -f "${COMPOSE_FILE_NAME}" ps --services | grep -q '^server$'; then
    echo "Starting database migrations..."
    docker compose -f "${COMPOSE_FILE_NAME}" run --rm \
      -e PGHOST="db" \
      -e PGPORT=5432 \
      -e PGDATABASE="${POSTGRES_DB}" \
      -e PGUSER="${POSTGRES_USER}" \
      -e PGPASSWORD="${POSTGRES_PASSWORD}" \
      server npm run migrate:up # Make sure 'server' is the correct service name
else
    echo "Skipping migrations: 'server' service not defined or not running."
fi


# --- Prune unused Docker images (Optional but Recommended) ---
echo "Pruning old Docker images..."
docker image prune -a -f --filter "label!=maintainer=Traefik" # Keep traefik image if needed, -a prunes unused AND dangling

# --- Logout from GHCR (Good Practice) ---
echo "Logging out from GHCR..."
docker logout ghcr.io

echo "--- Deployment for branch ${DEPLOY_BRANCH} finished successfully! ---"