FROM postgres:17
COPY init-app-db.sh /docker-entrypoint-initdb.d/init-app-db.sh
RUN chmod +x /docker-entrypoint-initdb.d/init-app-db.sh