#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# --- Validate ONLY the variables this script uses directly ---
required_vars=(DEPLOY_BRANCH COMPOSE_FILE_NAME GHCR_USER GHCR_TOKEN)
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "Error: Script environment variable '$var' is not set."
        exit 1
    fi
done

echo "Starting deployment for branch: ${DEPLOY_BRANCH}"
echo "Using compose file: ${COMPOSE_FILE_NAME}"

# --- Navigate to App Directory (already done in GHA, but good practice) ---
# cd is handled by the GitHub Action script block

echo "Pulling latest configuration files from origin/${DEPLOY_BRANCH}..."
git fetch origin "${DEPLOY_BRANCH}"
git reset --hard origin/"${DEPLOY_BRANCH}"
git clean -fd

echo "Logging in to GitHub Container Registry..."
echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin

# docker-compose will AUTOMATICALLY read the .env file in the current directory
echo "Pulling latest Docker images..."
docker compose -f "${COMPOSE_FILE_NAME}" pull

echo "Bringing down old services..."
docker compose -f "${COMPOSE_FILE_NAME}" down --remove-orphans

echo "Starting new services..."
docker compose -f "${COMPOSE_FILE_NAME}" up -d --force-recreate --remove-orphans

echo "Deployment finished. Pruning old images..."
docker image prune -a -f

echo "Logging out from GHCR..."
docker logout ghcr.io

echo "--- Deployment for branch ${DEPLOY_BRANCH} finished successfully! ---"