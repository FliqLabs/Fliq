from datetime import date, datetime, timedelta
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
QUERIES = ROOT / "analytics" / "queries"
FIXTURES = ROOT / "spec" / "fixtures"
PAYOUT = json.loads((FIXTURES / "payout.settled.json").read_text())
WORKSPACE = json.loads((FIXTURES / "workspace.current.json").read_text())["workspace_id"]
DAY = "2026-10-29"
ZONE = "Africa/Lagos"


def literal(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


class PayoutQueries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for binary in ("initdb", "pg_ctl", "psql"):
            if not shutil.which(binary):
                raise RuntimeError(f"{binary} must be on PATH; tests require a disposable PostgreSQL cluster")
        cls.env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
        cls.temp = tempfile.TemporaryDirectory(prefix="fliq-analytics-", dir="/tmp")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.data = str(Path(cls.temp.name) / "data")
        cls.run_command(["initdb", "-D", cls.data, "-U", "analytics_test", "-A", "trust", "--no-locale"])
        cls.run_command([
            "pg_ctl", "-D", cls.data, "-l", str(Path(cls.temp.name) / "postgres.log"),
            "-o", shlex.join(["-F", "-h", "", "-k", cls.temp.name]), "-w", "start",
        ])
        cls.addClassCleanup(cls.run_command, ["pg_ctl", "-D", cls.data, "-m", "immediate", "-w", "stop"])
        cls.psql = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", cls.temp.name,
                    "-U", "analytics_test", "-d", "postgres"]
        cls.run_command(cls.psql, """
            CREATE SCHEMA analytics;
            CREATE TABLE payout_samples (
                payout_id text, workspace_id text, provider text, status text,
                created_at timestamptz, settled_at timestamptz, seconds_to_bank numeric
            );
            CREATE TABLE event_samples (
                payout_id text, workspace_id text, status text, failure_reason text,
                occurred_at timestamptz, event_version integer
            );
            CREATE VIEW analytics.payouts AS SELECT * FROM payout_samples;
            CREATE VIEW analytics.payout_events AS SELECT * FROM event_samples;
        """)

    @classmethod
    def run_command(cls, args, sql=None):
        result = subprocess.run(args, input=sql, text=True, capture_output=True, env=cls.env)
        if result.returncode:
            raise RuntimeError(f"{args[0]} failed: {result.stderr or result.stdout}")
        return result.stdout.strip()

    def payout(self, **changes):
        return {
            "payout_id": PAYOUT["payout_id"], "workspace_id": WORKSPACE,
            "provider": PAYOUT["provider"], "status": PAYOUT["state"],
            "created_at": PAYOUT["history"][0]["at"],
            "settled_at": PAYOUT["history"][-1]["at"], "seconds_to_bank": PAYOUT["seconds"],
            **changes,
        }

    def event(self, **changes):
        return {
            "payout_id": PAYOUT["payout_id"], "workspace_id": WORKSPACE,
            "status": "failed", "failure_reason": "vault_daily_cap",
            "occurred_at": PAYOUT["history"][-1]["at"], "event_version": 1,
            **changes,
        }

    def query(self, name, payouts=(), events=(), params=None):
        sql = "TRUNCATE payout_samples, event_samples;\n"
        for table, rows in (("payout_samples", payouts), ("event_samples", events)):
            for row in rows:
                sql += f"INSERT INTO {table} ({', '.join(row)}) VALUES ({', '.join(map(literal, row.values()))});\n"
        query = (QUERIES / f"{name}.sql").read_text().strip().removesuffix(";")
        params = params if params is not None else [WORKSPACE, DAY, ZONE]
        arguments = f"({', '.join(map(literal, params))})" if params else ""
        sql += f"""
            SET TIME ZONE 'Pacific/Honolulu';
            BEGIN READ ONLY;
            PREPARE metric AS SELECT coalesce(json_agg(result), '[]'::json) FROM ({query}) result;
            EXECUTE metric{arguments};
            ROLLBACK;
        """
        return json.loads(self.run_command(self.psql, sql))

    def assert_daily(self, payouts, events, params, count, median, refusals):
        self.assertEqual(self.query("settled_count", payouts, events, params), [{"settled_count": count}])
        self.assertEqual(self.query("median_seconds_to_bank", payouts, events, params),
                         [{"median_seconds_to_bank": median}])
        self.assertEqual(self.query("cap_refusals", payouts, events, params), [{"cap_refusal_count": refusals}])

    def test_canonical_settlement(self):
        self.assert_daily([self.payout()], [], [WORKSPACE, DAY, ZONE], 1, PAYOUT["seconds"], 0)

    def test_non_settled_payout_with_settlement_timestamp_is_excluded(self):
        payouts = [self.payout(), self.payout(payout_id=str(uuid4()), status="failed", seconds_to_bank=0)]
        self.assertEqual(self.query("settled_count", payouts), [{"settled_count": 1}])
        self.assertEqual(self.query("median_seconds_to_bank", payouts),
                         [{"median_seconds_to_bank": PAYOUT["seconds"]}])
        self.assertEqual(self.query("provider_medians", payouts, params=[WORKSPACE, DAY, "2026-10-30", ZONE]),
                         [{"provider": PAYOUT["provider"], "median_seconds_to_bank": PAYOUT["seconds"], "sample_count": 1}])

    def test_empty_and_missing_workspace(self):
        self.assert_daily([], [], [WORKSPACE, DAY, ZONE], 0, None, 0)
        self.assertEqual(self.query("provider_medians", params=[WORKSPACE, DAY, "2026-10-30", ZONE]), [])
        self.assert_daily([self.payout()], [self.event()], [None, DAY, ZONE], 0, None, 0)
        for name in ("settled_count", "median_seconds_to_bank", "cap_refusals", "provider_medians"):
            with self.subTest(query=name), self.assertRaisesRegex(RuntimeError, "wrong number of parameters"):
                self.query(name, params=[])

    def test_local_midnights_and_dst(self):
        for day, zone, start, end in (
            (DAY, ZONE, "2026-10-28T23:00:00Z", "2026-10-29T23:00:00Z"),
            ("2026-03-08", "America/New_York", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"),
            ("2026-11-01", "America/New_York", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"),
        ):
            before = (datetime.fromisoformat(start) - timedelta(microseconds=1)).isoformat()
            last = (datetime.fromisoformat(end) - timedelta(microseconds=1)).isoformat()
            next_day = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
            for at, expected in ((before, 0), (start, 1), (last, 1), (end, 0)):
                with self.subTest(day=day, at=at):
                    self.assert_daily([self.payout(settled_at=at)], [self.event(occurred_at=at)],
                                      [WORKSPACE, day, zone], expected, PAYOUT["seconds"] if expected else None, expected)
                    expected_providers = [{"provider": PAYOUT["provider"],
                                           "median_seconds_to_bank": PAYOUT["seconds"], "sample_count": 1}] if expected else []
                    self.assertEqual(self.query("provider_medians", [self.payout(settled_at=at)],
                                                params=[WORKSPACE, day, next_day, zone]), expected_providers)

    def test_workspace_isolation(self):
        other_workspace = str(uuid4())
        payouts = [self.payout(), self.payout(payout_id=str(uuid4()), workspace_id=other_workspace, seconds_to_bank=0)]
        events = [self.event(), self.event(workspace_id=other_workspace, payout_id=str(uuid4()))]
        self.assert_daily(payouts, events, [WORKSPACE, DAY, ZONE], 1, PAYOUT["seconds"], 1)
        self.assertEqual(self.query("provider_medians", payouts, params=[WORKSPACE, DAY, "2026-10-30", ZONE]),
                         [{"provider": PAYOUT["provider"], "median_seconds_to_bank": PAYOUT["seconds"], "sample_count": 1}])

    def test_refusal_event_time_reason_status_and_duplicates(self):
        events = [self.event(), self.event(event_version=2),
                  self.event(payout_id=str(uuid4()), failure_reason="vault_per_payout_cap")]
        for reason in ("vault_corridor_not_allowed", "vault_cooldown", "quote_expired", "provider_unavailable", "provider_rejected", "deposit_expired"):
            events.append(self.event(payout_id=str(uuid4()), failure_reason=reason))
        events += [self.event(payout_id=str(uuid4()), status="created"),
                   self.event(occurred_at="2026-10-29T23:00:00Z")]
        payout = self.payout(status="failed", created_at="2026-10-28T12:00:00Z", settled_at=None)
        self.assertEqual(self.query("cap_refusals", [payout], events), [{"cap_refusal_count": 2}])
        self.assertEqual(self.query("cap_refusals", [self.payout()], [self.event(occurred_at="2026-10-28T12:00:00Z")]),
                         [{"cap_refusal_count": 0}])

    def test_medians_null_samples_and_provider_range(self):
        payouts = [self.payout(), self.payout(payout_id=str(uuid4()), seconds_to_bank=0),
                   self.payout(payout_id=str(uuid4()), seconds_to_bank=None),
                   self.payout(payout_id=str(uuid4()), provider="busha", seconds_to_bank=None),
                   self.payout(payout_id=str(uuid4()), settled_at=None, seconds_to_bank=0),
                   self.payout(payout_id=str(uuid4()), settled_at="2026-10-29T23:00:00Z", seconds_to_bank=0)]
        self.assertEqual(self.query("median_seconds_to_bank", payouts), [{"median_seconds_to_bank": PAYOUT["seconds"] / 2}])
        self.assertEqual(self.query("provider_medians", payouts, params=[WORKSPACE, DAY, "2026-10-30", ZONE]), [
            {"provider": "busha", "median_seconds_to_bank": None, "sample_count": 0},
            {"provider": PAYOUT["provider"], "median_seconds_to_bank": PAYOUT["seconds"] / 2, "sample_count": 2},
        ])
        self.assert_daily([self.payout(seconds_to_bank=None)], [], [WORKSPACE, DAY, ZONE], 1, None, 0)

    def test_multiple_settlement_dates(self):
        payouts = [self.payout(), self.payout(payout_id=str(uuid4()), settled_at="2026-10-30T22:59:59Z"),
                   self.payout(payout_id=str(uuid4()), settled_at="2026-10-30T23:00:00Z", seconds_to_bank=0)]
        self.assertEqual(self.query("provider_medians", payouts, params=[WORKSPACE, DAY, "2026-10-31", ZONE]),
                         [{"provider": PAYOUT["provider"], "median_seconds_to_bank": PAYOUT["seconds"], "sample_count": 2}])


if __name__ == "__main__":
    unittest.main()
