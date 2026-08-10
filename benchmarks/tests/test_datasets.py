import hashlib
import json
from pathlib import Path

import pytest
import run_eval

from run_eval import DATASET_HASHES, dataset_sha256, effective_tasks, load_tasks, select_tasks


def test_stealth_webcmd_loads_editable_json_and_hash_tracks_file(tmp_path, monkeypatch):
    path = tmp_path / "Stealth_Webcmd.json"
    path.write_text(json.dumps([{"task_id": 1}, {"task_id": 2}]), encoding="utf-8")
    monkeypatch.setattr(run_eval, "DATASET_DIR", tmp_path)

    tasks = load_tasks("Stealth_Webcmd")

    assert [task["_raw_index"] for task in tasks] == [0, 1]
    assert dataset_sha256("Stealth_Webcmd") == hashlib.sha256(path.read_bytes()).hexdigest()


def test_bu_loads_editable_json_while_stealth_remains_encrypted():
    bu = load_tasks("BU_Bench_V1")
    stealth = load_tasks("Stealth_Bench_V1")

    assert len(bu) == 100
    assert len(stealth) == 80
    assert [task["_raw_index"] for task in bu[:3]] == [0, 1, 2]
    assert (Path("datasets") / "BU_Bench_V1.json").exists()
    assert set(DATASET_HASHES) == {"BU_Bench_V1", "Stealth_Bench_V1"}


def test_bu_manifest_hash_tracks_editable_json():
    path = Path("datasets/BU_Bench_V1.json")

    assert dataset_sha256("BU_Bench_V1") == hashlib.sha256(path.read_bytes()).hexdigest()


def test_bu_interleaves_five_twenty_task_sections():
    tasks = effective_tasks("BU_Bench_V1", load_tasks("BU_Bench_V1"), "raw")
    assert [task["_raw_index"] for task in tasks[:10]] == [0, 20, 40, 60, 80, 1, 21, 41, 61, 81]
    assert [task["_effective_index"] for task in tasks[:3]] == [0, 1, 2]


def test_bu_skips_disabled_tasks_after_interleaving_without_changing_raw_indices():
    tasks = effective_tasks("BU_Bench_V1", load_tasks("BU_Bench_V1"), "raw")

    assert len(tasks) == 99
    assert 42 not in [task["_raw_index"] for task in tasks]
    assert tasks[12]["_raw_index"] == 62
    assert tasks[12]["_effective_index"] == 12


def test_stealth_official_view_is_exactly_seventy_one_tasks():
    tasks = effective_tasks("Stealth_Bench_V1", load_tasks("Stealth_Bench_V1"), "official")
    ids = {str(task["task_id"]) for task in tasks}

    assert len(tasks) == 71
    assert not ids.intersection({"60", "61", "62", "63", "64", "65", "66", "75", "80"})
    assert next(task["category"] for task in tasks if str(task["task_id"]) == "76") == "Akamai"
    assert next(task["category"] for task in tasks if str(task["task_id"]) == "77") == "Cloudflare"
    assert next(task["category"] for task in tasks if str(task["task_id"]) == "79") == "Others"


def test_task_selection_accepts_count_all_or_effective_indices():
    tasks = effective_tasks("BU_Bench_V1", load_tasks("BU_Bench_V1"), "raw")

    assert len(select_tasks(tasks, "5", None)) == 5
    assert len(select_tasks(tasks, "all", None)) == 99
    assert [task["_raw_index"] for task in select_tasks(tasks, None, "0,4")] == [0, 80]

    with pytest.raises(ValueError, match="exactly one"):
        select_tasks(tasks, "5", "0,4")
    with pytest.raises(ValueError, match="out of range"):
        select_tasks(tasks, None, "99")
