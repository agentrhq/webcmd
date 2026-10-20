"""Deterministic browser-state detectors for recovery planning.

This module analyzes normalized observations only. It does not launch a browser,
click elements, type input, or otherwise mutate browser state.
"""

from __future__ import annotations

from difflib import SequenceMatcher
import re
import string
from typing import Any, Mapping, Sequence


_PUNCT_TRANSLATION = str.maketrans({char: " " for char in string.punctuation})
_ACTION_SYNONYMS: tuple[frozenset[str], ...] = (
    frozenset({"submit", "send", "post", "confirm"}),
    frozenset({"cancel", "close", "dismiss"}),
    frozenset({"back", "previous", "return"}),
    frozenset({"next", "continue", "proceed"}),
    frozenset({"delete", "remove", "trash"}),
    frozenset({"save", "store"}),
    frozenset({"open", "expand", "show"}),
    frozenset({"search", "find", "lookup"}),
    frozenset({"login", "sign", "signin", "sign-in", "authenticate"}),
)


def _is_mapping(value: Any) -> bool:
    return isinstance(value, Mapping)


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    normalized = str(value).lower().translate(_PUNCT_TRANSLATION)
    return re.sub(r"\s+", " ", normalized).strip()


def _tokenize(value: Any) -> list[str]:
    normalized = _normalize_text(value)
    return normalized.split() if normalized else []


def _candidate_label(candidate: Any) -> str:
    if not _is_mapping(candidate):
        return str(candidate)

    for key in ("name", "text", "aria_label", "label", "title", "placeholder"):
        value = candidate.get(key)
        if value:
            return str(value)

    return str(candidate.get("role", ""))


def _candidate_role(candidate: Any) -> str:
    if not _is_mapping(candidate):
        return ""

    for key in ("role", "aria_role", "tag", "type"):
        value = candidate.get(key)
        if value:
            return _normalize_text(value)

    return ""


def _expected_label(expected: Any) -> str:
    if _is_mapping(expected):
        for key in ("name", "text", "aria_label", "label", "title", "placeholder"):
            value = expected.get(key)
            if value:
                return str(value)
    return str(expected)


def _expected_role(expected: Any) -> str:
    if not _is_mapping(expected):
        return ""

    for key in ("role", "aria_role", "tag", "type"):
        value = expected.get(key)
        if value:
            return _normalize_text(value)
    return ""


def _extract_candidates(current_elements: Any) -> list[Any]:
    if current_elements is None:
        return []

    if _is_mapping(current_elements):
        for key in ("elements", "candidates", "observed_elements", "nodes", "items"):
            value = current_elements.get(key)
            if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
                return list(value)
        if "role" in current_elements or "text" in current_elements or "name" in current_elements:
            return [current_elements]
        return [current_elements]

    if isinstance(current_elements, Sequence) and not isinstance(current_elements, (str, bytes, bytearray)):
        return list(current_elements)

    return [current_elements]


def _synonym_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0

    for group in _ACTION_SYNONYMS:
        if left in group and right in group:
            return 0.85
    return 0.0


def _token_similarity(expected_tokens: list[str], observed_tokens: list[str]) -> float:
    if not expected_tokens and not observed_tokens:
        return 1.0
    if not expected_tokens or not observed_tokens:
        return 0.0

    def _best_score(source: list[str], target: list[str]) -> float:
        scores: list[float] = []
        for left in source:
            best = 0.0
            for right in target:
                best = max(best, _synonym_similarity(left, right))
                if best < 1.0:
                    best = max(best, SequenceMatcher(None, left, right).ratio())
            scores.append(best)
        return sum(scores) / len(scores) if scores else 0.0

    forward = _best_score(expected_tokens, observed_tokens)
    reverse = _best_score(observed_tokens, expected_tokens)
    return (forward + reverse) / 2.0


def _label_similarity(expected_label: str, observed_label: str) -> tuple[float, str]:
    expected_raw = str(expected_label).strip()
    observed_raw = str(observed_label).strip()
    if expected_raw == observed_raw:
        return 1.0, "exact_match"

    expected_normalized = _normalize_text(expected_raw)
    observed_normalized = _normalize_text(observed_raw)
    if expected_normalized == observed_normalized:
        return 0.99, "normalized_match"

    sequence_score = SequenceMatcher(None, expected_normalized, observed_normalized).ratio()
    token_score = _token_similarity(_tokenize(expected_raw), _tokenize(observed_raw))
    score = (sequence_score * 0.45) + (token_score * 0.55)
    return round(score, 4), "fuzzy_match"


def _structural_bonus(expected: Any, candidate: Any) -> float:
    if not (_is_mapping(expected) and _is_mapping(candidate)):
        return 0.0

    bonus = 0.0
    expected_role = _expected_role(expected)
    candidate_role = _candidate_role(candidate)
    if expected_role and expected_role == candidate_role:
        bonus += 0.06

    for key in ("visible", "enabled", "focused", "selected", "checked"):
        if key in expected and key in candidate and expected.get(key) == candidate.get(key):
            bonus += 0.02

    expected_parent = expected.get("parent")
    candidate_parent = candidate.get("parent")
    if expected_parent is not None and candidate_parent is not None and expected_parent == candidate_parent:
        bonus += 0.05

    expected_index = expected.get("index")
    candidate_index = candidate.get("index")
    if expected_index is not None and candidate_index is not None and expected_index == candidate_index:
        bonus += 0.03

    return min(bonus, 0.15)


def _score_candidate(expected: Any, candidate: Any) -> dict[str, Any]:
    expected_label = _expected_label(expected)
    observed_label = _candidate_label(candidate)
    score, label_match_type = _label_similarity(expected_label, observed_label)
    score = min(score + _structural_bonus(expected, candidate), 1.0)

    expected_role = _expected_role(expected)
    candidate_role = _candidate_role(candidate)
    role_match = bool(expected_role and expected_role == candidate_role)

    if label_match_type == "exact_match":
        confidence = 1.0
    elif label_match_type == "normalized_match":
        confidence = 0.99
    elif role_match and score >= 0.75:
        confidence = round(min(score + 0.03, 1.0), 4)
    else:
        confidence = round(score, 4)

    if label_match_type == "exact_match":
        match_type = "exact_match"
    elif label_match_type == "normalized_match":
        match_type = "normalized_match"
    elif role_match and score >= 0.7:
        match_type = "role_text_match"
    elif score >= 0.7:
        match_type = "fuzzy_match"
    else:
        match_type = "low_similarity"

    if match_type == "role_text_match" and role_match:
        change_type = "structural_relocation"
    elif match_type in {"exact_match", "normalized_match"}:
        change_type = match_type
    elif score >= 0.7:
        change_type = "renamed_element"
    else:
        change_type = "no_suitable_candidate"

    return {
        "expected": expected_label,
        "observed": observed_label,
        "score": confidence,
        "match_type": match_type,
        "change_type": change_type,
        "role_match": role_match,
        "candidate": candidate,
    }


def detect_element_change(expected: Any, current_elements: Any) -> dict[str, Any]:
    """Compare an expected element against the observed candidates.

    Returns a structured description of the strongest candidate and whether the
    expected element appears unchanged, renamed, or absent.
    """

    candidates = _extract_candidates(current_elements)
    if not candidates:
        return {
            "changed": True,
            "expected": _expected_label(expected),
            "observed_candidates": [],
            "best_candidate": None,
            "confidence": 0.0,
            "change_type": "no_observations",
            "matches": [],
        }

    scored = [_score_candidate(expected, candidate) for candidate in candidates]
    scored.sort(key=lambda item: (item["score"], item["change_type"] == "exact_match"), reverse=True)
    best = scored[0]

    observed_labels = [item["observed"] for item in scored]
    exact_hit = best["change_type"] == "exact_match" and best["expected"] == best["observed"]
    normalized_hit = best["change_type"] == "normalized_match"

    if exact_hit:
        changed = False
        change_type = "exact_match"
    elif normalized_hit:
        changed = False
        change_type = "normalized_match"
    elif best["score"] >= 0.7:
        changed = True
        change_type = "renamed_element" if best["match_type"] != "role_text_match" else "structural_relocation"
    else:
        changed = True
        change_type = "no_suitable_candidate"

    return {
        "changed": changed,
        "expected": _expected_label(expected),
        "observed_candidates": observed_labels,
        "best_candidate": best["observed"],
        "confidence": best["score"],
        "change_type": change_type,
        "matches": scored,
    }


def detect_page_change(expected_state: Any, current_state: Any) -> dict[str, Any]:
    """Compare coarse page state dictionaries.

    The detector focuses on portable fields such as title, url, visible text,
    and counts of interactive elements. Missing fields are ignored.
    """

    if not _is_mapping(expected_state) or not _is_mapping(current_state):
        return {
            "changed": False,
            "change_type": "insufficient_state",
            "confidence": 0.0,
            "mismatches": {},
        }

    tracked_keys = (
        "url",
        "title",
        "route",
        "screen",
        "visible_text",
        "page_text",
        "interactive_count",
        "element_count",
    )
    mismatches: dict[str, dict[str, Any]] = {}
    matches = 0
    considered = 0

    for key in tracked_keys:
        expected_value = expected_state.get(key)
        current_value = current_state.get(key)
        if expected_value is None or current_value is None:
            continue
        considered += 1
        if isinstance(expected_value, str) and isinstance(current_value, str):
            if _normalize_text(expected_value) == _normalize_text(current_value):
                matches += 1
                continue
        elif expected_value == current_value:
            matches += 1
            continue
        mismatches[key] = {"expected": expected_value, "observed": current_value}

    confidence = round(matches / considered, 4) if considered else 0.0
    changed = bool(mismatches)
    change_type = "page_changed" if changed else "page_stable"
    return {
        "changed": changed,
        "change_type": change_type,
        "confidence": confidence,
        "mismatches": mismatches,
    }


def detect_modal(current_state: Any) -> dict[str, Any]:
    """Detect blocking modal/pop-up state from generic observations."""

    if not _is_mapping(current_state):
        return {
            "detected": False,
            "change_type": "insufficient_state",
            "confidence": 0.0,
            "modals": [],
        }

    modal_entries: list[Any] = []
    for key in ("modals", "dialogs", "overlays", "popups"):
        value = current_state.get(key)
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            modal_entries.extend(value)

    if not modal_entries and any(current_state.get(key) for key in ("modal", "dialog", "popup")):
        modal_entries.append({key: current_state.get(key) for key in ("modal", "dialog", "popup") if current_state.get(key)})

    if not modal_entries:
        return {
            "detected": False,
            "change_type": "no_modal",
            "confidence": 0.0,
            "modals": [],
        }

    labels = [_candidate_label(entry) for entry in modal_entries]
    return {
        "detected": True,
        "change_type": "unexpected_modal",
        "confidence": 1.0 if labels else 0.0,
        "modals": labels,
    }


def detect_error(current_state: Any) -> dict[str, Any]:
    """Detect page or workflow errors from generic observations."""

    if not _is_mapping(current_state):
        return {
            "detected": False,
            "change_type": "insufficient_state",
            "confidence": 0.0,
            "messages": [],
        }

    messages: list[str] = []
    for key in ("errors", "error_messages", "alerts", "warnings"):
        value = current_state.get(key)
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            messages.extend(str(item) for item in value if item)
        elif value:
            messages.append(str(value))

    text_blobs = [str(current_state.get(key)) for key in ("page_text", "visible_text", "status_text") if current_state.get(key)]
    for blob in text_blobs:
        normalized = _normalize_text(blob)
        if any(term in normalized for term in ("error", "failed", "failure", "not found", "blocked", "forbidden", "timeout")):
            messages.append(blob)

    if not messages:
        return {
            "detected": False,
            "change_type": "no_error",
            "confidence": 0.0,
            "messages": [],
        }

    return {
        "detected": True,
        "change_type": "unexpected_error",
        "confidence": 1.0,
        "messages": messages,
    }


def detect_loading(current_state: Any) -> dict[str, Any]:
    """Detect slow-loading or busy states from generic observations."""

    if not _is_mapping(current_state):
        return {
            "detected": False,
            "change_type": "insufficient_state",
            "confidence": 0.0,
        }

    explicit_flags = [current_state.get(key) for key in ("loading", "is_loading", "busy", "pending")]
    if any(flag is True for flag in explicit_flags):
        return {
            "detected": True,
            "change_type": "loading",
            "confidence": 1.0,
        }

    text_blobs = [str(current_state.get(key)) for key in ("page_text", "visible_text", "status_text") if current_state.get(key)]
    for blob in text_blobs:
        normalized = _normalize_text(blob)
        if any(term in normalized for term in ("loading", "please wait", "working", "processing", "retrying")):
            return {
                "detected": True,
                "change_type": "loading",
                "confidence": 0.8,
            }

    return {
        "detected": False,
        "change_type": "not_loading",
        "confidence": 0.0,
    }
