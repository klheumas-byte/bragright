import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ErrorState from "../components/ErrorState";
import { OpponentSearchSkeleton } from "../components/MatchSkeletons";
import PlayerIdentity from "../components/PlayerIdentity";
import SidebarIcon from "../components/SidebarIcon";
import TrophyWatermark from "../components/TrophyWatermark";
import { Button, Card, EmptyState, Field, PageSection, Select, Textarea } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getPlayers, getPublicPlayerProfile, scheduleMatch } from "../services/api";
import { getMatchErrorMessage } from "./matchPresentation";

const SEARCH_DELAY_MS = 300;
const EMPTY_DETAILS = {
  game: "",
  match_type: "Competitive Match",
  scheduled_at: "",
  request_message: "",
};

export default function SubmitMatch() {
  const [searchParams] = useSearchParams();
  const requestedOpponentId = searchParams.get("opponentId") || "";
  const navigate = useNavigate();
  const { user } = useAuth();
  const { trackLoading } = useLoading();
  const requestRef = useRef(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [opponents, setOpponents] = useState([]);
  const [selectedOpponent, setSelectedOpponent] = useState(null);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.classList.add("challenge-player-route");
    return () => document.body.classList.remove("challenge-player-route");
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearch(search.trim().replace(/\s+/g, " ")),
      SEARCH_DELAY_MS
    );
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => { loadOpponents(); }, [debouncedSearch, user?.id]);

  useEffect(() => {
    if (!requestedOpponentId || selectedOpponent?.id === requestedOpponentId) return;
    const loaded = opponents.find((player) => player.id === requestedOpponentId);
    if (loaded) {
      setSelectedOpponent(loaded);
      return;
    }
    getPublicPlayerProfile(requestedOpponentId)
      .then((response) => {
        if (response?.data?.id && response.data.id !== user?.id) setSelectedOpponent(response.data);
      })
      .catch(() => setError("The requested opponent is not available."));
  }, [opponents, requestedOpponentId, selectedOpponent?.id, user?.id]);

  async function loadOpponents({ forceRefresh = false } = {}) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const response = await trackLoading(() => getPlayers({
        page: 1,
        limit: 20,
        search: debouncedSearch,
        forceRefresh,
      }));
      if (requestId !== requestRef.current) return;
      setOpponents(
        Array.isArray(response?.data?.players)
          ? response.data.players.filter((player) => player.id !== user?.id)
          : []
      );
    } catch (loadError) {
      if (requestId === requestRef.current) {
        setError(getMatchErrorMessage(loadError, "Opponents could not be loaded."));
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  async function submitChallenge(event) {
    event.preventDefault();
    if (!selectedOpponent?.id || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await trackLoading(() => scheduleMatch({
        opponent_id: selectedOpponent.id,
        game: details.game,
        match_type: details.match_type,
        scheduled_at: details.scheduled_at
          ? new Date(details.scheduled_at).toISOString()
          : null,
        request_message: details.request_message,
      }));
      const createdMatch = response?.data || response?.match;
      setSelectedOpponent(null);
      setSearch("");
      setDetails(EMPTY_DETAILS);
      if (createdMatch?.id) navigate(`/matches/${createdMatch.id}/sent`, { replace: true });
    } catch (submitError) {
      setError(getMatchErrorMessage(submitError, "The challenge could not be created."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardLayout title="New Challenge" description="Create one clear match request.">
      <Card as="section" variant="dashboard" className="feature-hero-card match-hero match-challenge-hero">
        <TrophyWatermark className="arena-hero-watermark" />
        <div>
          <p className="section-label">Match request</p>
          <h2 className="feature-hero-title">Challenge a player.</h2>
          <p className="match-hero-copy">Choose an opponent and send the details for their response.</p>
        </div>
      </Card>

      <ErrorState message={error} onRetry={() => loadOpponents({ forceRefresh: true })} retryLabel="Refresh opponents" />

      <PageSection className="challenge-page-section" title="New challenge" description="The opponent must accept before a result can be entered.">
        <Card variant="information" className="match-form-card match-challenge-card">
          <form className="match-form challenge-form" onSubmit={submitChallenge}>
            <Field
              id="opponent-search"
              type="search"
              label="Search eligible opponents"
              value={search}
              maxLength={64}
              placeholder="Search by username"
              disabled={submitting}
              onChange={(event) => setSearch(event.target.value)}
            />

            {loading && !opponents.length ? <OpponentSearchSkeleton /> : (
              <div className={`opponent-search-region${loading ? " loading-region--refreshing" : ""}`} aria-busy={loading || undefined}>
                {opponents.length ? (
                  <div className="opponent-results" role="group" aria-label="Eligible opponents">
                    {opponents.map((player) => {
                      const selected = selectedOpponent?.id === player.id;
                      return (
                        <button
                          key={player.id}
                          type="button"
                          aria-pressed={selected}
                          className={`opponent-option-card${selected ? " opponent-option-selected" : ""}`}
                          disabled={submitting}
                          onClick={() => setSelectedOpponent(player)}
                        >
                          <PlayerIdentity player={player} variant="compact" className="opponent-option-copy" />
                          {selected ? <span className="opponent-selected-check" aria-label="Selected opponent"><SidebarIcon name="check" decorative /></span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : !loading && !error ? <Card variant="empty"><EmptyState title="No eligible opponents found" description="Try another username or clear the search." /></Card> : null}
              </div>
            )}

            {selectedOpponent ? (
              <Card variant="dashboard" className="selected-opponent-card" aria-live="polite">
                <PlayerIdentity player={selectedOpponent} variant="compact" label="Selected opponent" className="selected-opponent-copy" />
                <span className="selected-opponent-confirmation" aria-label="Opponent selected"><SidebarIcon name="check" decorative /></span>
                <Button variant="ghost" size="sm" disabled={submitting} onClick={() => setSelectedOpponent(null)}>Change</Button>
              </Card>
            ) : null}

            <div className="match-score-grid">
              <Field id="challenge-game" label="Game" maxLength={80} placeholder="e.g. EA Sports FC" value={details.game} disabled={submitting} onChange={(event) => setDetails((current) => ({ ...current, game: event.target.value }))} />
              <Field control={Select} id="challenge-type" label="Match type" value={details.match_type} disabled={submitting} onChange={(event) => setDetails((current) => ({ ...current, match_type: event.target.value }))}>
                <option>Competitive Match</option>
                <option>Friendly Match</option>
                <option>Tournament Match</option>
              </Field>
            </div>
            <Field id="challenge-scheduled" type="datetime-local" label="Scheduled date and time" value={details.scheduled_at} disabled={submitting} onChange={(event) => setDetails((current) => ({ ...current, scheduled_at: event.target.value }))} />
            <Field control={Textarea} id="challenge-message" label="Optional message" rows={3} maxLength={500} value={details.request_message} disabled={submitting} onChange={(event) => setDetails((current) => ({ ...current, request_message: event.target.value }))} />
            <div className="challenge-submit-action">
              <Button type="submit" disabled={!selectedOpponent || submitting} isLoading={submitting} loadingText="Sending challenge…">Send Challenge</Button>
            </div>
          </form>
        </Card>
      </PageSection>
    </DashboardLayout>
  );
}
