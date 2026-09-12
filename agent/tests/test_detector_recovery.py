from agent.detector import detect_element_change
from agent.recovery import recover_action


def test_exact_match_detects_unchanged_element():
    expected = "Submit Enquiry"
    current = ["Submit Enquiry"]

    result = detect_element_change(expected, current)

    assert result["changed"] is False
    assert result["change_type"] == "exact_match"
    assert result["best_candidate"] == "Submit Enquiry"
    assert result["confidence"] == 1.0


def test_normalized_match_detects_whitespace_variation():
    expected = "Submit Enquiry"
    current = ["  submit   enquiry  "]

    result = detect_element_change(expected, current)
    recovery = recover_action(expected, current)

    assert result["changed"] is False
    assert result["change_type"] == "normalized_match"
    assert result["best_candidate"] == "  submit   enquiry  "
    assert result["confidence"] == 0.99
    assert recovery["status"] == "recovered"
    assert recovery["strategy"] == "normalized_match"


def test_recovery_prefers_renamed_candidate_with_confidence():
    expected = "Submit Enquiry"
    current = ["Send Enquiry"]

    detection = detect_element_change(expected, current)
    recovery = recover_action(expected, current)

    assert detection["changed"] is True
    assert detection["change_type"] == "renamed_element"
    assert detection["best_candidate"] == "Send Enquiry"
    assert detection["confidence"] >= 0.8
    assert recovery["status"] == "recovered"
    assert recovery["strategy"] in {"fuzzy_relocation", "normalized_match", "structural_relocation"}
    assert recovery["replacement_target"] == "Send Enquiry"


def test_unrelated_elements_request_replan():
    expected = "Submit Enquiry"
    current = ["Login", "Home", "Profile"]

    result = recover_action(expected, current)

    assert result["status"] == "needs_replan"
    assert result["replacement_target"] is None
    assert result["reason"] == "No sufficiently confident replacement found"


def test_multiple_candidates_choose_only_strong_enough_match():
    expected = "Submit Enquiry"
    current = ["Send Enquiry", "Cancel", "Submit Application"]

    detection = detect_element_change(expected, current)
    recovery = recover_action(expected, current)

    assert detection["best_candidate"] == "Send Enquiry"
    assert detection["confidence"] >= 0.7
    assert recovery["status"] in {"recovered", "needs_replan"}
    if recovery["status"] == "recovered":
        assert recovery["replacement_target"] == "Send Enquiry"
        assert recovery["confidence"] >= 0.7


def test_unexpected_modal_requests_replan():
    expected = "Submit Enquiry"
    current = ["Send Enquiry"]
    current_state = {
        "modals": [
            {"role": "dialog", "name": "International Shopping Transition Alert", "text": "Change Address"},
        ]
    }

    result = recover_action(expected, current, current_state=current_state)

    assert result["status"] == "needs_replan"
    assert result["strategy"] == "modal_blocked"
    assert result["replacement_target"] is None


def test_loading_state_requests_replan():
    expected = "Submit Enquiry"
    current = ["Send Enquiry"]
    current_state = {"loading": True}

    result = recover_action(expected, current, current_state=current_state)

    assert result["status"] == "needs_replan"
    assert result["strategy"] == "wait_for_loading"
    assert result["replacement_target"] is None


def test_page_divergence_requests_backtrack_when_available():
    expected = {"url": "https://shop.example/cart", "title": "Cart"}
    current = ["Proceed to checkout"]
    current_state = {
        "url": "https://shop.example/home",
        "title": "Home",
        "backtrack_available": True,
    }

    result = recover_action(
        "Submit Enquiry",
        current,
        expected_state=expected,
        current_state=current_state,
    )

    assert result["status"] == "needs_backtrack"
    assert result["strategy"] == "backtrack_request"
    assert result["replacement_target"] is None


def test_low_confidence_candidate_requests_replan():
    expected = "Submit Enquiry"
    current = ["Join Now", "Home", "Profile"]

    detection = detect_element_change(expected, current)
    recovery = recover_action(expected, current)

    assert detection["change_type"] == "no_suitable_candidate"
    assert detection["confidence"] < 0.7
    assert recovery["status"] == "needs_replan"
    assert recovery["strategy"] == "low_confidence"
    assert recovery["replacement_target"] is None


def test_case_and_whitespace_normalize_to_match():
    expected = "Submit Enquiry"
    current = ["  submit   enquiry  "]

    result = detect_element_change(expected, current)

    assert result["changed"] is False
    assert result["change_type"] == "normalized_match"
    assert result["best_candidate"] == "  submit   enquiry  "
    assert result["confidence"] == 0.99
