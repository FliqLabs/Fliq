# pg_dump must be at least the server's major version; production runs Postgres 18.
FROM postgres:18-alpine

RUN apk add --no-cache aws-cli

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

ENTRYPOINT []
CMD ["/usr/local/bin/backup.sh"]
