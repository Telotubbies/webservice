"""F04: bucketed tag-history rows carry the min-max band (rollup mn/mx) the
standard chart draws, so a spike averaged away inside a bucket stays visible."""

from pathlib import Path

SRC = (Path(__file__).resolve().parents[2] / "backend" / "app" / "production" / "tagquery.py").read_text(encoding="utf8")


def test_bucket_rows_expose_min_max_avg_n():
    assert '"min": finite_or_none(r["mn"])' in SRC
    assert '"max": finite_or_none(r["mx"])' in SRC
    assert '("ts", "min", "max", "avg", "n")' in SRC


def test_rollup_branch_rebuckets_with_min_and_max_not_avg_of_avgs():
    assert "min(mn) AS mn, max(mx) AS mx" in SRC
