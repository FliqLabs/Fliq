from getpass import GetPassWarning, getpass
import json
from pathlib import Path
import sys
import warnings

import psycopg
from psycopg.rows import dict_row


QUERY_DIRECTORY = Path(__file__).resolve().parent / "queries"
REPORT_DATE = "2026-11-05"
TIMEZONE = "Africa/Lagos"
PROVIDER_START = "2026-11-03"
PROVIDER_END = "2026-11-06"


def select_workspace(cursor, workspace_id):
    if workspace_id:
        return workspace_id

    cursor.execute("""
        SELECT DISTINCT workspace_id
        FROM analytics.payouts
        WHERE workspace_id IS NOT NULL AND workspace_id <> ''
        ORDER BY workspace_id
    """)
    workspaces = [row["workspace_id"] for row in cursor.fetchall()]
    if not workspaces:
        print("No workspace IDs found in analytics.payouts; no metrics run.")
        return None

    for number, workspace in enumerate(workspaces, start=1):
        print(f"{number}. {workspace}")
    while True:
        selection = input("Select one workspace number: ").strip()
        try:
            number = int(selection)
        except ValueError:
            print("Enter a listed workspace number.")
            continue
        if 1 <= number <= len(workspaces):
            return workspaces[number - 1]
        print("Enter a listed workspace number.")


def main():
    with warnings.catch_warnings():
        warnings.simplefilter("error", GetPassWarning)
        database_url = getpass("DATABASE_URL: ")
    if not database_url.strip():
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1
    workspace_id = input("workspace_id (blank to select): ").strip()

    with psycopg.connect(
        database_url,
        connect_timeout=10,
        options="-c default_transaction_read_only=on -c statement_timeout=15000",
        autocommit=True,
        cursor_factory=psycopg.RawCursor,
        row_factory=dict_row,
    ) as connection:
        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            workspace_id = select_workspace(cursor, workspace_id)
            if workspace_id is None:
                return 1

            daily_params = (workspace_id, REPORT_DATE, TIMEZONE)
            queries = (
                ("settled_count.sql", daily_params),
                ("median_seconds_to_bank.sql", daily_params),
                ("cap_refusals.sql", daily_params),
                ("provider_medians.sql", (workspace_id, PROVIDER_START, PROVIDER_END, TIMEZONE)),
            )
            print(f"Daily report: {REPORT_DATE}; timezone: {TIMEZONE}")
            print(f"Provider dates: [{PROVIDER_START}, {PROVIDER_END}); timezone: {TIMEZONE}")
            print(f"Workspace: {workspace_id}")
            for filename, params in queries:
                cursor.execute((QUERY_DIRECTORY / filename).read_text(), params)
                print(f"{filename}:")
                print(json.dumps(cursor.fetchall(), indent=2))
    return 0


if __name__ == "__main__":
    try:
        exit_code = main()
    except (KeyboardInterrupt, EOFError):
        exit_code = 1
    except Exception as error:
        print(f"{type(error).__name__} SQLSTATE={getattr(error, 'sqlstate', None) or 'N/A'}", file=sys.stderr)
        exit_code = 1
    sys.exit(exit_code)
