#!/bin/sh
set -eu -o pipefail

: "${DATABASE_URL:?}" "${BACKUP_BUCKET:?}" "${BACKUP_S3_ENDPOINT:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

RECENT_HOURS="${BACKUP_RECENT_HOURS:-24}"
HOURLY_DAYS="${BACKUP_HOURLY_DAYS:-7}"
DAILY_DAYS="${BACKUP_DAILY_DAYS:-90}"

s3() { aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 "$@"; }

now=$(date -u +%s)
stamp=$(date -u -d "@$now" +%Y%m%dT%H%MZ)
hour=$(date -u -d "@$now" +%Y%m%dT%H)
day=$(date -u -d "@$now" +%Y%m%d)
file="/tmp/fliq-$stamp.dump"
bucket="s3://$BACKUP_BUCKET"

pg_dump "$DATABASE_URL" --format=custom --no-owner --file="$file"
tables=$(pg_restore --list "$file" | grep -c 'TABLE DATA')
[ "$tables" -gt 0 ] || { echo "dump $stamp has no table data" >&2; exit 1; }

s3 cp --only-show-errors "$file" "$bucket/recent/$stamp.dump"

# Keyed on the hour and day rather than the minute, so a run that starts late still produces the hourly and daily copy.
if ! s3 ls "$bucket/hourly/$hour" >/dev/null 2>&1; then
  s3 cp --only-show-errors "$file" "$bucket/hourly/${hour}Z.dump"
fi
if ! s3 ls "$bucket/daily/$day" >/dev/null 2>&1; then
  s3 cp --only-show-errors "$file" "$bucket/daily/${day}Z.dump"
fi

prune() {
  prefix=$1
  cutoff=$2
  s3 ls "$bucket/$prefix/" | awk '{print $4}' | awk -v cutoff="$cutoff" '$0 != "" && ($0 "") < (cutoff "")' |
    while read -r key; do s3 rm --only-show-errors "$bucket/$prefix/$key"; done
}

prune recent "$(date -u -d "@$((now - RECENT_HOURS * 3600))" +%Y%m%dT%H%MZ)"
prune hourly "$(date -u -d "@$((now - HOURLY_DAYS * 86400))" +%Y%m%dT%H)"
prune daily "$(date -u -d "@$((now - DAILY_DAYS * 86400))" +%Y%m%d)"

echo "backup $stamp: $(du -h "$file" | cut -f1), $tables tables"
rm -f "$file"
