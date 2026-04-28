from .match_workflow import create_match_action_items
from .player_profile_service import build_profile_overview, get_matches_for_user


def get_dashboard_summary(current_user_id, matches_collection):
    related_matches = get_matches_for_user(current_user_id, matches_collection)
    overview = build_profile_overview(related_matches, current_user_id)

    return {
        **overview,
        "actions_required": overview.get("actions_required", 0),
    }


def get_dashboard_actions(current_user, matches_collection, *, is_admin=False):
    return create_match_action_items(current_user, matches_collection, is_admin=is_admin)


def get_dashboard_notifications(current_user, matches_collection, *, is_admin=False):
    actions = get_dashboard_actions(current_user, matches_collection, is_admin=is_admin)
    return {
        "counts": {
            "actions_required": actions["total_actions_count"],
            "match_requests": actions["match_requests_count"],
            "pending_confirmations": actions["pending_confirmations_count"],
            "disputed_matches": actions["disputed_matches_count"],
        },
        "items": [
            {
                "id": item["id"],
                "type": item["type"],
                "message": item["message"],
                "match_id": item["related_match_id"],
                "created_at": item["created_at"],
                "action_label": "Review Now",
                "action_path": item["action_url"],
            }
            for item in actions["items"]
        ],
    }


def get_dashboard_action_center(current_user, matches_collection, *, is_admin=False):
    actions = get_dashboard_actions(current_user, matches_collection, is_admin=is_admin)
    review_required = actions["total_actions_count"]

    cards = [
        {
            "id": "match-requests",
            "title": "Match Requests",
            "description": "Newly scheduled matches waiting for the opponent to accept or decline.",
            "count": actions["match_requests_count"],
            "action_label": "Open Matches",
            "action_path": "/dashboard/matches",
            "tone": "active" if actions["match_requests_count"] else "neutral",
        },
        {
            "id": "pending-confirmations",
            "title": "Pending Confirmations",
            "description": "Submitted results waiting for your approval or dispute.",
            "count": actions["pending_confirmations_count"],
            "action_label": "Review Matches",
            "action_path": "/dashboard/matches",
            "tone": "urgent" if actions["pending_confirmations_count"] else "neutral",
        },
        {
            "id": "disputed-matches",
            "title": "Disputes",
            "description": "Matches that still need a final review before the record is trusted.",
            "count": actions["disputed_matches_count"],
            "action_label": "Open Disputes",
            "action_path": "/admin/disputes" if is_admin else "/dashboard/matches",
            "tone": "warning" if actions["disputed_matches_count"] else "neutral",
        },
    ]

    return {
        "summary": {
            "actions_required": review_required,
            "match_requests": actions["match_requests_count"],
            "pending_confirmations": actions["pending_confirmations_count"],
            "disputed_matches": actions["disputed_matches_count"],
            "review_required_items": review_required,
        },
        "actions": cards,
        "items": actions["items"],
        "messages": {
            "has_actions": review_required > 0,
        },
    }
