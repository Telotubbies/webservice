# pg_dump (matches the postgres:16 server) + rclone for S3 upload (Garage).
FROM postgres:16-alpine
RUN apk add --no-cache rclone
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
