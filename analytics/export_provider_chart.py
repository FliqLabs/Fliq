import argparse
from datetime import date
from getpass import GetPassWarning, getpass
import math
from pathlib import Path
import sys
import textwrap
import warnings
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


DIRECTORY = Path(__file__).resolve().parent
EXPORT_DIRECTORY = DIRECTORY / "exports"
DATA_LABELS = {"test": "TEST DATA — not real payout performance", "live": "LIVE DATA"}
CAVEAT = "Provider medians alone do not establish provider quality or comparable routes."


def render_svg(rows, workspace_id, start_date, end_date_exclusive, timezone, data_label):
    if data_label not in DATA_LABELS:
        raise ValueError("An explicit test or live data label is required")
    values = [float(row["median_seconds_to_bank"]) for row in rows
              if row["median_seconds_to_bank"] is not None]
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("Medians must be finite and nonnegative")

    svg = ET.Element("svg", xmlns="http://www.w3.org/2000/svg", width="1120",
                     role="img", **{"aria-labelledby": "title description",
                                    "font-family": "system-ui, sans-serif"})
    ET.SubElement(svg, "title", id="title").text = "Provider delivery time"
    ET.SubElement(svg, "desc", id="description").text = (
        f"Median seconds from deposit_seen to settled. {DATA_LABELS[data_label]}. {CAVEAT}"
    )
    background = ET.SubElement(svg, "rect", width="1120", height="100%", fill="#ffffff")

    def text(x, y, content, size=14, **attributes):
        ET.SubElement(svg, "text", x=str(x), y=str(y), **{"font-size": str(size), **attributes}).text = str(content)

    text(24, 36, "Provider delivery time", 26, **{"font-weight": "700"})
    text(24, 68, DATA_LABELS[data_label], 18,
         fill="#b91c1c" if data_label == "test" else "#166534", **{"font-weight": "700"})
    y = 96
    for content in (
        f"Workspace: {workspace_id}",
        f"Settlement dates: {start_date} inclusive to {end_date_exclusive} exclusive",
        f"Timezone: {timezone}",
        "Definition: deposit_seen to settled (seconds)",
    ):
        for line in textwrap.wrap(content, width=120):
            text(24, y, line)
            y += 20

    top = y + 24
    row_y = top
    positions = []
    for row in rows:
        lines = textwrap.wrap(str(row["provider"]), width=26) or ["(unknown provider)"]
        height = max(52, 18 * len(lines) + 14)
        positions.append((row, lines, row_y, height))
        row_y += height
    axis_y = row_y + 12
    maximum = max(values, default=0) or 1
    if values:
        for tick in range(5):
            x = 260 + tick * 140
            ET.SubElement(svg, "line", x1=str(x), y1=str(top - 12), x2=str(x), y2=str(axis_y),
                          stroke="#cbd5e1")
            text(x, axis_y + 22, f"{maximum * tick / 4:.4g}", **{"text-anchor": "middle"})
        text(540, axis_y + 48, "Median seconds to bank", **{"text-anchor": "middle"})
    if not rows:
        text(24, top + 16, "No settled payouts in the selected workspace and date range.")

    for row, lines, position, height in positions:
        for line_number, line in enumerate(lines):
            text(24, position + 23 + line_number * 18, line)
        median = row["median_seconds_to_bank"]
        if median is None:
            text(280, position + 23, "Median unavailable")
        else:
            width = float(median) / maximum * 560
            ET.SubElement(svg, "rect", x="260", y=str(position + 6), width=f"{width:.4f}",
                          height="28", fill="#0f766e", **{"class": "bar"})
            text(840, position + 23, f"{float(median):.4g} s")
        text(970, position + 23, f"n = {row['sample_count']}")

    footer_y = max(axis_y + 82, top + 64)
    for line in textwrap.wrap(CAVEAT, width=120):
        text(24, footer_y, line, 13, fill="#475569")
        footer_y += 18
    height = footer_y + 18
    svg.set("height", str(height))
    svg.set("viewBox", f"0 0 1120 {height}")
    background.set("height", str(height))
    return ET.tostring(svg, encoding="unicode", xml_declaration=True)


def fetch_medians(workspace_id, start_date, end_date_exclusive, timezone):
    import psycopg
    from psycopg.rows import dict_row

    query = (DIRECTORY / "queries" / "provider_medians.sql").read_text()
    with warnings.catch_warnings():
        warnings.simplefilter("error", GetPassWarning)
        database_url = getpass("DATABASE_URL: ")
    if not database_url.strip():
        raise ValueError("DATABASE_URL is required")
    with psycopg.connect(
        database_url, connect_timeout=10,
        options="-c default_transaction_read_only=on -c statement_timeout=15000",
        autocommit=True, cursor_factory=psycopg.RawCursor, row_factory=dict_row,
    ) as connection:
        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            cursor.execute(query, (workspace_id, start_date, end_date_exclusive, timezone))
            return cursor.fetchall()


def main():
    parser = argparse.ArgumentParser(description="Export workspace provider medians as a standalone SVG.")
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--start-date", required=True, type=date.fromisoformat)
    parser.add_argument("--end-date-exclusive", required=True, type=date.fromisoformat)
    parser.add_argument("--timezone", required=True)
    parser.add_argument("--data-label", required=True, choices=DATA_LABELS)
    parser.add_argument("--output", required=True, type=Path, help="New .svg file under analytics/exports/")
    args = parser.parse_args()
    args.workspace_id = args.workspace_id.strip()
    if not args.workspace_id or args.start_date >= args.end_date_exclusive:
        parser.error("A workspace and a nonempty ascending date range are required")
    try:
        ZoneInfo(args.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        parser.error("Use an IANA timezone such as Africa/Lagos")
    output = args.output.expanduser().resolve()
    if not output.is_relative_to(EXPORT_DIRECTORY.resolve()) or output.suffix.lower() != ".svg":
        parser.error("Output must be an .svg file under analytics/exports/")
    if output.exists():
        parser.error("Output already exists; choose a new filename")
    rows = fetch_medians(args.workspace_id, args.start_date, args.end_date_exclusive, args.timezone)
    svg = render_svg(rows, args.workspace_id, args.start_date, args.end_date_exclusive, args.timezone, args.data_label)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as destination:
        destination.write(svg + "\n")
    print(f"Saved {output}")
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
