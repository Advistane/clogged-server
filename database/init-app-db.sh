#!/bin/bash
set -e

# Log start of execution
echo "Starting database initialization script"

# Check if environment variables are set
if [ -z "$APP_DB_USER" ] || [ -z "$APP_DB_PASSWORD" ] || [ -z "$POSTGRES_DB" ]; then
  echo "ERROR: Required environment variables are not set"
  echo "APP_DB_USER: ${APP_DB_USER:-not set}"
  echo "APP_DB_PASSWORD: ${APP_DB_PASSWORD:-not set}"
  echo "POSTGRES_DB: ${POSTGRES_DB:-not set}"
  exit 1
fi

echo "Creating user ${APP_DB_USER} and setting up database schema"

# Execute SQL with verbose output
psql -v ON_ERROR_STOP=1 -U postgres -d "${POSTGRES_DB}" <<-EOSQL
-- Create user
CREATE USER ${APP_DB_USER} WITH PASSWORD '${APP_DB_PASSWORD}';

-- Create tables
CREATE TABLE IF NOT EXISTS npcs
(
    id   integer PRIMARY KEY,
    name text
);

CREATE TABLE IF NOT EXISTS items
(
    id integer PRIMARY KEY,
    name text
);

CREATE TABLE IF NOT EXISTS categories
(
    id SERIAL PRIMARY KEY,
    name text UNIQUE
);

CREATE TABLE IF NOT EXISTS subcategories
(
    id SERIAL PRIMARY KEY,
    categoryId INTEGER REFERENCES categories(id),
    name text UNIQUE
);

CREATE TABLE IF NOT EXISTS collection_logs
(
    id SERIAL PRIMARY KEY,
    accountHash numeric,
    itemId INTEGER REFERENCES items(id),
    subcategoryId INTEGER REFERENCES subcategories(id),
    UNIQUE (accountHash, itemId)
);

CREATE TABLE IF NOT EXISTS player_kc
(
    id SERIAL PRIMARY KEY,
    accountHash numeric,
    subcategoryId INTEGER REFERENCES subcategories(id),
    kc integer,
    UNIQUE (accountHash, subcategoryId)
);

CREATE TABLE IF NOT EXISTS players
(
    accountHash numeric PRIMARY KEY,
    username text
);

-- Add indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_collection_logs_account_hash ON collection_logs(accountHash);
CREATE INDEX IF NOT EXISTS idx_collection_logs_subcategory ON collection_logs(subcategoryId);
CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_player_kc_composite ON player_kc(accountHash, subcategoryId);

-- Grant appropriate permissions to application user
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER};
GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_DB_USER};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_DB_USER};

-- Make sure new tables will grant permissions to the app user
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_DB_USER};
EOSQL

# Verify tables were created
# Verify tables were created - specify database and look at all schemas
echo "Verifying tables were created:"
psql -U postgres -d "${POSTGRES_DB}" -c "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'public';"

# Add these diagnostic queries to your script
echo "Current database and schema:"
psql -U postgres -c "SELECT current_database(), current_schema();"

echo "Available schemas:"
psql -U postgres -c "SELECT schema_name FROM information_schema.schemata;"

echo "All tables across all schemas:"
psql -U postgres -c "SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE';"

echo "Database initialization completed"