# ./database/Dockerfile

# Use the desired PostgreSQL version
FROM postgres:17

# --- DEPRECATED ---
# Remove or comment out the line copying the old init.sql if the .sh script replaces its functionality
# COPY init.sql /docker-entrypoint-initdb.d/
# ------------------

# Copy the new initialization shell script into the entrypoint init directory
COPY init-app-db.sh /docker-entrypoint-initdb.d/init-app-db.sh
#COPY init.sql /docker-entrypoint-initdb.d/init.sql

# Add execute permissions to the shell script within the image
# This ensures the entrypoint script can run it
RUN chmod +x /docker-entrypoint-initdb.d/init-app-db.sh

# Optional: Add any custom PostgreSQL configuration here if needed
# Example: COPY postgresql.conf /etc/postgresql/postgresql.conf
# RUN chmod 644 /etc/postgresql/postgresql.conf

# The default CMD from the base image will start PostgreSQL
# The entrypoint script will automatically run scripts in /docker-entrypoint-initdb.d/