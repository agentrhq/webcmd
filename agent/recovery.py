"""Recovery decision logic for WebCMD-driven browser workflows.

This module never executes browser actions. It only analyzes observed state and
returns a recovery decision for the integration layer to execute via WebCMD.
"""

from __future__ import annotations

from typing import Any, Mapping

from agent.detector import (
    detect_element_change,
    detect_error,
    detect_loading,
    detect_modal,
    detect_page_change,
)


def _as_mapping(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def _best_recovery_strategy(match: dict[str, Any]) -> str:
    if match["change_type"] == "exact_match":
        return "exact_match"
    if match["change_type"] == "normalized_match":
        return "normalized_match"
    if match["change_type"] == "structural_relocation":
        return "structural_relocation"
    if match["score"] >= 0.8:
        return "fuzzy_relocation"
    return "no_suitable_candidate"


def recover_action(
    expected: Any,
    current_elements: Any = None,
    *,
    expected_state: Mapping[str, Any] | None = None,
    current_state: Mapping[str, Any] | None = None,
    confidence_threshold: float = 0.8,
) -> dict[str, Any]:
    """Return a recovery decision without performing browser actions.

    The returned decision is intentionally generic so that an integration layer
    can translate it into a WebCMD browser command.
    """

    element_change = detect_element_change(expected, current_elements)

    if not element_change["observed_candidates"]:
        return {
            "status": "needs_replan",
            "strategy": "no_observations",
            "original_target": element_change["expected"],
            "replacement_target": None,
            "confidence": 0.0,
            "reason": "No observed elements were available for recovery",
        }

    current_state_map = _as_mapping(current_state)
    expected_state_map = _as_mapping(expected_state)

    if current_state_map is not None:
        modal = detect_modal(current_state_map)
        if modal["detected"]:
            return {
                "status": "needs_replan",
                "strategy": "modal_blocked",
                "original_target": element_change["expected"],
                "replacement_target": None,
                "confidence": modal["confidence"],
                "reason": "Unexpected modal or popup is blocking the target",
            }

        loading = detect_loading(current_state_map)
        if loading["detected"]:
            return {
                "status": "needs_replan",
                "strategy": "wait_for_loading",
                "original_target": element_change["expected"],
                "replacement_target": None,
                "confidence": loading["confidence"],
                "reason": "Page is still loading or busy",
            }

        error = detect_error(current_state_map)
        if error["detected"]:
            return {
                "status": "needs_replan",
                "strategy": "error_detected",
                "original_target": element_change["expected"],
                "replacement_target": None,
                "confidence": error["confidence"],
                "reason": "Unexpected error state detected",
            }

    if expected_state_map is not None and current_state_map is not None:
        page_change = detect_page_change(expected_state_map, current_state_map)
        if page_change["changed"] and (
            current_state_map.get("history_back_available")
            or current_state_map.get("can_go_back")
            or current_state_map.get("backtrack_available")
        ):
            return {
                "status": "needs_backtrack",
                "strategy": "backtrack_request",
                "original_target": element_change["expected"],
                "replacement_target": None,
                "confidence": page_change["confidence"],
                "reason": "Current page diverged from the expected state and back navigation is available",
            }

    if element_change["change_type"] in {"exact_match", "normalized_match"} and not element_change["changed"]:
        return {
            "status": "recovered",
            "strategy": element_change["change_type"],
            "original_target": element_change["expected"],
            "replacement_target": element_change["best_candidate"],
            "confidence": element_change["confidence"],
            "reason": "Expected target was found unchanged",
        }

    best_match = next(
        (match for match in element_change["matches"] if match["observed"] == element_change["best_candidate"]),
        None,
    )
    if best_match is None:
        return {
            "status": "needs_replan",
            "strategy": "no_match",
            "original_target": element_change["expected"],
            "replacement_target": None,
            "confidence": 0.0,
            "reason": "No candidate could be scored",
        }

    if best_match["score"] >= confidence_threshold and best_match["change_type"] != "no_suitable_candidate":
        strategy = _best_recovery_strategy(best_match)
        if strategy == "no_suitable_candidate":
            strategy = "fuzzy_relocation"
        reason = "Expected target was renamed" if best_match["change_type"] == "renamed_element" else "Expected target was relocated"
        return {
            "status": "recovered",
            "strategy": strategy,
            "original_target": element_change["expected"],
            "replacement_target": element_change["best_candidate"],
            "confidence": best_match["score"],
            "reason": reason,
        }

    return {
        "status": "needs_replan",
        "strategy": "low_confidence",
        "original_target": element_change["expected"],
        "replacement_target": None,
        "confidence": best_match["score"],
        "reason": "No sufficiently confident replacement found",
    }
