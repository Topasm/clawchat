"""A review card lists the files a run changed when its executor recorded them."""

import json
from types import SimpleNamespace

from services.review.review_item_service import run_changed_files


def _run(usage):
    return SimpleNamespace(usage_json=None if usage is None else json.dumps(usage))


def test_files_recorded_by_the_executor_are_listed():
    run = _run(
        {
            "files": [
                {"file": "fig/fig1_latency.png", "status": "added", "additions": 0, "deletions": 0},
                {"file": "report.md", "status": "modified", "additions": 40, "deletions": 3},
                {"status": "added"},
            ]
        }
    )
    assert run_changed_files(run) == [
        {"path": "fig/fig1_latency.png", "status": "added", "additions": 0, "deletions": 0},
        {"path": "report.md", "status": "modified", "additions": 40, "deletions": 3},
    ]


def test_an_executor_that_does_not_diff_says_nothing():
    assert run_changed_files(_run(None)) is None
    assert run_changed_files(_run({"cwd": "/tmp/x"})) is None
    assert run_changed_files(SimpleNamespace(usage_json="{not json")) is None


def test_an_empty_diff_is_an_empty_list():
    assert run_changed_files(_run({"files": []})) == []
