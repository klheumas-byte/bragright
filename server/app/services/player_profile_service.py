from .match_workflow import (
    MATCH_STATUS_CONFIRMED,
    MATCH_STATUS_DISPUTED,
    MATCH_STATUS_MATCH_REQUESTED,
    MATCH_STATUS_PENDING_CONFIRMATION,
    MATCH_STATUS_PENDING_RESULT,
    get_matches_for_user,
    normalize_match_status,
    serialize_match,
)


def resolve_match_view_for_user(match_document, user_id):
    serialized_match = serialize_match(match_document, user_id, include_actions=False)
    serialized_match["played_at"] = (
        serialized_match.get("confirmed_at")
        or serialized_match.get("disputed_at")
        or serialized_match.get("result_submitted_at")
        or serialized_match.get("created_at")
    )
    return serialized_match


def build_profile_overview(match_documents, user_id):
    serialized_matches = [resolve_match_view_for_user(match_document, user_id) for match_document in match_documents]
    actionable_matches = [serialize_match(match_document, user_id, include_actions=True) for match_document in match_documents]
    confirmed_matches = [match for match in serialized_matches if normalize_match_status(match["status"]) == MATCH_STATUS_CONFIRMED]

    wins = sum(1 for match in confirmed_matches if match["result"] == "win")
    losses = sum(1 for match in confirmed_matches if match["result"] == "loss")
    draws = sum(1 for match in confirmed_matches if match["result"] == "draw")
    pending_matches = sum(
        1
        for match in serialized_matches
        if normalize_match_status(match["status"]) in {
            MATCH_STATUS_MATCH_REQUESTED,
            MATCH_STATUS_PENDING_RESULT,
            MATCH_STATUS_PENDING_CONFIRMATION,
        }
    )
    disputed_matches = sum(
        1 for match in serialized_matches if normalize_match_status(match["status"]) == MATCH_STATUS_DISPUTED
    )
    actions_required = sum(
        1
        for match in actionable_matches
        if (
            match.get("can_accept")
            or match.get("can_decline")
            or match.get("can_confirm")
            or match.get("can_dispute")
            or match.get("can_submit_result")
        )
    )

    return {
        "total_matches": len(serialized_matches),
        "wins": wins,
        "losses": losses,
        "draws": draws,
        "pending_matches": pending_matches,
        "disputed_matches": disputed_matches,
        "actions_required": actions_required,
        "recent_summary": serialized_matches[:3],
    }
