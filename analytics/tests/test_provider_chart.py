import json
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET


DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DIRECTORY))
from export_provider_chart import CAVEAT, render_svg


FIXTURES = DIRECTORY.parent / "spec" / "fixtures"
PAYOUT = json.loads((FIXTURES / "payout.settled.json").read_text())
WORKSPACE = json.loads((FIXTURES / "workspace.current.json").read_text())["workspace_id"]
NS = {"svg": "http://www.w3.org/2000/svg"}


class ProviderChart(unittest.TestCase):
    def render(self, rows, **changes):
        options = dict(workspace_id=WORKSPACE, start_date="2026-11-03",
                       end_date_exclusive="2026-11-06", timezone="Africa/Lagos", data_label="test")
        return ET.fromstring(render_svg(rows, **(options | changes)))

    def row(self, **changes):
        return {"provider": PAYOUT["provider"], "median_seconds_to_bank": PAYOUT["seconds"],
                "sample_count": 1, **changes}

    def text(self, root):
        return " ".join(root.itertext())

    def test_horizontal_bar_starts_at_zero_and_has_context(self):
        root = self.render([self.row()])
        bar = root.find("svg:rect[@class='bar']", NS)
        self.assertEqual((bar.get("x"), bar.get("width"), bar.get("height")), ("260", "560.0000", "28"))
        self.assertIsNotNone(root.find("svg:text[@x='260'][.='0']", NS))
        for expected in (WORKSPACE, PAYOUT["provider"], f"{PAYOUT['seconds']} s", "n = 1", "Africa/Lagos",
                         "2026-11-03 inclusive to 2026-11-06 exclusive", "deposit_seen to settled", CAVEAT):
            self.assertIn(expected, self.text(root))

    def test_text_is_escaped_and_cannot_create_elements(self):
        payload = '<script onload="alert(1)">& provider</script>'
        root = self.render([self.row(provider=payload)], workspace_id=payload)
        self.assertIn(payload, self.text(root))
        self.assertEqual(root.findall(".//svg:script", NS), [])
        self.assertFalse(any("onload" in element.attrib for element in root.iter()))

    def test_empty_results_have_no_bars_or_zero_median(self):
        root = self.render([])
        self.assertIn("No settled payouts", self.text(root))
        self.assertEqual(root.findall("svg:rect[@class='bar']", NS), [])
        self.assertNotIn("0 s", self.text(root))

    def test_null_is_unavailable_while_actual_zero_is_zero(self):
        root = self.render([self.row(median_seconds_to_bank=None, sample_count=0)])
        self.assertIn("Median unavailable", self.text(root))
        self.assertIn("n = 0", self.text(root))
        self.assertEqual(root.findall("svg:rect[@class='bar']", NS), [])
        self.assertNotIn("0 s", self.text(root))
        zero = self.render([self.row(median_seconds_to_bank=0)])
        self.assertIn("0 s", self.text(zero))
        self.assertEqual(zero.find("svg:rect[@class='bar']", NS).get("width"), "0.0000")

    def test_data_label_is_explicit_and_independent_of_workspace(self):
        self.assertIn("TEST DATA — not real payout performance", self.text(self.render([])))
        live = self.text(self.render([], data_label="live", workspace_id="test"))
        self.assertIn("LIVE DATA", live)
        self.assertNotIn("TEST DATA", live)
        for label in (None, "", "unknown"):
            with self.subTest(label=label), self.assertRaises(ValueError):
                self.render([], data_label=label)


if __name__ == "__main__":
    unittest.main()
