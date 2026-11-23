# Production database backups

The `postgres-backup` service in the Railway production environment runs `backup.sh` every 5 minutes as a cron job. Each run takes a `pg_dump` of production Postgres, checks it lists table data, and uploads it to the private `fliq-db-backups` bucket.

| Prefix | Written | Kept |
| --- | --- | --- |
| `recent/` | every run | 24 hours (`BACKUP_RECENT_HOURS`) |
| `hourly/` | first run of each UTC hour | 7 days (`BACKUP_HOURLY_DAYS`) |
| `daily/` | first run of each UTC day | 90 days (`BACKUP_DAILY_DAYS`) |

A failed run exits non-zero and shows as a failed cron run on the service. The service reads `DATABASE_URL` and the bucket credentials through Railway variable references, so nothing is copied by hand.

## Deploy

The service is not connected to GitHub. Deploy this folder on its own:

```
railway up services/api/infra/backup --path-as-root --service postgres-backup --environment production
```

The schedule (`*/5 * * * *`) and the restart policy (`NEVER`) are service settings in Railway, not files here.

## Restore

Download a dump with the bucket credentials (`railway bucket credentials --bucket fliq-db-backups --environment production`), then restore it into a new, empty database with a Postgres 18 client:

```
aws --endpoint-url https://t3.storageapi.dev s3 cp s3://<bucket>/recent/<stamp>.dump .
pg_restore --no-owner --dbname "<new database url>" <stamp>.dump
```

Restore into a fresh database and switch `DATABASE_URL` over once it checks out. Restoring over the live database overwrites rows written since the dump.
