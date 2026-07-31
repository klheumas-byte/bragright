import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import RichMatchCard from "../components/RichMatchCard";
import MatchCenter from "../components/MatchCenter";
import CompetitiveSummary from "../components/CompetitiveSummary";
import {
  MatchControlsSkeleton,
  MatchDetailSkeleton,
  MatchListSkeleton,
  MatchSummarySkeleton,
} from "../components/MatchSkeletons";
import ErrorState from "../components/ErrorState";
import SectionSkeleton from "../components/SectionSkeleton";
import SuccessAlert from "../components/SuccessAlert";
import SidebarIcon from "../components/SidebarIcon";
import TrophyWatermark from "../components/TrophyWatermark";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageSection,
  Textarea,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  acceptMatch,
  cancelMatch,
  confirmMatch,
  declineMatch,
  disputeMatch,
  getDashboardActions,
  getHeadToHead,
  getMatchDetail,
  getMyMatches,
  submitMatchResult,
  uploadMatchProof,
} from "../services/api";
import {
  MATCH_VIEWS,
  formatMatchDate,
  getMatchErrorMessage,
  getMatchStatusPresentation,
  validateMatchScores,
  validateProofFile,
} from "./matchPresentation";
import { getMatchPhaseDestination } from "./matchPhaseNavigation";
import { getPendingPlayerActions } from "../components/competitiveIntelligenceViewModel";

const PAGE_SIZE = 20;
const EMPTY_PAGINATION = {
  page: 1,
  limit: PAGE_SIZE,
  total: 0,
  pages: 0,
  has_next: false,
  has_previous: false,
};
const EMPTY_DRAFT = { player_score: "", opponent_score: "" };

export default function MyMatches() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { trackLoading } = useLoading();
  const selectedMatchId = new URLSearchParams(location.search).get("matchId") || "";
  const requestIdRef = useRef(0);
  const rivalryRequestIdRef = useRef(0);
  const rivalryCacheRef = useRef(new Map());
  const [activeView, setActiveView] = useState("attention");
  const [matches, setMatches] = useState([]);
  const [viewCounts, setViewCounts] = useState({});
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [actions, setActions] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [rivalry, setRivalry] = useState(null);
  const [rivalryError, setRivalryError] = useState("");
  const [isRivalryLoading, setIsRivalryLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [activeActionKey, setActiveActionKey] = useState("");
  const [pendingDialog, setPendingDialog] = useState(null);
  const [resultDrafts, setResultDrafts] = useState({});
  const [proofFiles, setProofFiles] = useState({});
  const [proofErrors, setProofErrors] = useState({});
  const [uploadStates, setUploadStates] = useState({});
  const [disputeNotes, setDisputeNotes] = useState({});

  useEffect(() => {
    loadMatches();
  }, [activeView, pagination.page]);

  useEffect(() => {
    loadActions();
  }, []);

  useEffect(() => {
    if (!selectedMatchId) {
      setSelectedMatch(null);
      setDetailError("");
      setRivalry(null);
      setRivalryError("");
      return;
    }
    loadSelectedMatch(selectedMatchId);
  }, [selectedMatchId]);

  useEffect(() => {
    const playerOneId = selectedMatch?.player_one_id;
    const playerTwoId = selectedMatch?.player_two_id;
    if (!playerOneId || !playerTwoId || playerOneId === playerTwoId) {
      setRivalry(null);
      setRivalryError("");
      return;
    }
    loadRivalry(playerOneId, playerTwoId);
  }, [selectedMatch?.player_one_id, selectedMatch?.player_two_id]);

  async function loadMatches({ forceRefresh = false } = {}) {
    const requestId = ++requestIdRef.current;
    if (isLoading) {
      setIsLoading(true);
    } else {
      setIsTransitioning(true);
    }
    setListError("");
    try {
      const response = await trackLoading(() =>
        getMyMatches({
          page: pagination.page,
          limit: PAGE_SIZE,
          view: activeView,
          forceRefresh,
        })
      );
      if (requestId !== requestIdRef.current) {
        return;
      }
      const data = response?.data || {};
      setMatches(Array.isArray(data.matches) ? data.matches : []);
      setViewCounts(data.view_counts || {});
      setPagination({
        page: Number(data.page) || 1,
        limit: Number(data.limit) || PAGE_SIZE,
        total: Number(data.total) || 0,
        pages: Number(data.pages) || 0,
        has_next: Boolean(data.has_next),
        has_previous: Boolean(data.has_previous),
      });
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setListError(getMatchErrorMessage(error, "Your matches could not be loaded."));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsTransitioning(false);
      }
    }
  }

  async function loadActions({ forceRefresh = false } = {}) {
    try {
      const response = await trackLoading(() => getDashboardActions({ forceRefresh }));
      setActions(Array.isArray(response?.data?.items) ? response.data.items : []);
    } catch (error) {
      setActions([]);
    }
  }

  async function loadSelectedMatch(matchId, { forceRefresh = false } = {}) {
    setIsDetailLoading(true);
    setDetailError("");
    try {
      const response = await trackLoading(() =>
        getMatchDetail(matchId, { forceRefresh })
      );
      setSelectedMatch(response?.data || null);
    } catch (error) {
      setSelectedMatch(null);
      setDetailError(getMatchErrorMessage(error, "The selected match could not be loaded."));
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function loadRivalry(playerOneId, playerTwoId, { forceRefresh = false } = {}) {
    const requestId = ++rivalryRequestIdRef.current;
    const cacheKey = `${playerOneId}:${playerTwoId}`;
    const cachedEntry = rivalryCacheRef.current.get(cacheKey);
    if (!forceRefresh && cachedEntry?.data) {
      setRivalry(cachedEntry.data);
      setRivalryError("");
      setIsRivalryLoading(false);
      return;
    }
    setIsRivalryLoading(true);
    setRivalryError("");
    const request = !forceRefresh && cachedEntry?.request
      ? cachedEntry.request
      : getHeadToHead(playerOneId, playerTwoId);
    rivalryCacheRef.current.set(cacheKey, { request });
    try {
      const response = await request;
      const data = response?.data || null;
      rivalryCacheRef.current.set(cacheKey, { data });
      if (requestId === rivalryRequestIdRef.current) {
        setRivalry(data);
      }
    } catch (error) {
      if (rivalryCacheRef.current.get(cacheKey)?.request === request) {
        rivalryCacheRef.current.delete(cacheKey);
      }
      if (requestId === rivalryRequestIdRef.current) {
        setRivalry(null);
        setRivalryError(getMatchErrorMessage(error, "Player comparison could not be loaded."));
      }
    } finally {
      if (requestId === rivalryRequestIdRef.current) {
        setIsRivalryLoading(false);
      }
    }
  }

  function changeView(view) {
    setActiveView(view);
    setPagination((current) => ({ ...current, page: 1 }));
  }

  function changeDraft(matchId, field, value) {
    setResultDrafts((current) => ({
      ...current,
      [matchId]: { ...(current[matchId] || EMPTY_DRAFT), [field]: value },
    }));
  }

  function selectProof(matchId, file) {
    const error = validateProofFile(file);
    setProofErrors((current) => ({ ...current, [matchId]: error }));
    setProofFiles((current) => ({
      ...current,
      [matchId]: error ? null : file || null,
    }));
    setUploadStates((current) => ({ ...current, [matchId]: "" }));
  }

  function requestAction(match, actionType) {
    if (activeActionKey) {
      return;
    }
    if (actionType === "accept") {
      executeAction(match, actionType);
      return;
    }
    if (actionType === "decline") {
      navigate(`/matches/${encodeURIComponent(match.id)}/respond`);
      return;
    }
    if (actionType === "submit-result") {
      navigate(`/matches/${encodeURIComponent(match.id)}/result/submit`);
      return;
    }
    if (actionType === "confirm" || actionType === "dispute") {
      navigate(`/matches/${encodeURIComponent(match.id)}/result/confirm`);
      return;
    }
    setPendingDialog({ match, actionType });
  }

  async function executeAction(match, actionType) {
    const actionKey = `${match.id}:${actionType}`;
    if (activeActionKey) {
      return;
    }
    setActiveActionKey(actionKey);
    setFeedback({ type: "", message: "" });
    try {
      let response;
      if (actionType === "accept") {
        response = await trackLoading(() => acceptMatch(match.id));
      } else if (actionType === "decline") {
        response = await trackLoading(() => declineMatch(match.id));
      } else if (actionType === "cancel") {
        response = await trackLoading(() => cancelMatch(match.id));
      } else if (actionType === "confirm") {
        response = await trackLoading(() => confirmMatch(match.id));
      } else if (actionType === "dispute") {
        const disputeNote = String(disputeNotes[match.id] || "").trim();
        if (!disputeNote) {
          throw new Error("Explain why the submitted result is incorrect.");
        }
        response = await trackLoading(() =>
          disputeMatch(match.id, { dispute_note: disputeNote })
        );
      } else {
        response = await submitResult(match);
      }
      setFeedback({ type: "success", message: response.message });
      setPendingDialog(null);
      if (actionType === "accept") {
        const acceptedMatch = response.data || response.match;
        const phaseDestination =
          getMatchPhaseDestination(acceptedMatch, "respond") ||
          `/matches/${encodeURIComponent(match.id)}/result/submit`;
        navigate(phaseDestination, { replace: true });
        return;
      }
      if (actionType === "submit-result") {
        setResultDrafts((current) => ({ ...current, [match.id]: EMPTY_DRAFT }));
        setProofFiles((current) => ({ ...current, [match.id]: null }));
        setUploadStates((current) => ({ ...current, [match.id]: "" }));
      }
      if (actionType === "dispute") {
        setDisputeNotes((current) => ({ ...current, [match.id]: "" }));
      }
      await Promise.all([
        loadMatches({ forceRefresh: true }),
        loadActions({ forceRefresh: true }),
        selectedMatchId
          ? loadSelectedMatch(selectedMatchId, { forceRefresh: true })
          : Promise.resolve(),
        selectedMatch?.player_one_id && selectedMatch?.player_two_id
          ? loadRivalry(selectedMatch.player_one_id, selectedMatch.player_two_id, { forceRefresh: true })
          : Promise.resolve(),
      ]);
    } catch (error) {
      setFeedback({
        type: "error",
        message: getMatchErrorMessage(error),
      });
    } finally {
      setActiveActionKey("");
    }
  }

  async function submitResult(match) {
    const draft = resultDrafts[match.id] || EMPTY_DRAFT;
    const scoreError = validateMatchScores(draft.player_score, draft.opponent_score);
    if (scoreError) {
      throw new Error(scoreError);
    }
    const proofFile = proofFiles[match.id];
    const proofError = validateProofFile(proofFile);
    if (proofError) {
      setProofErrors((current) => ({ ...current, [match.id]: proofError }));
      throw new Error(proofError);
    }
    let proofImageUrl = null;
    if (proofFile) {
      setUploadStates((current) => ({ ...current, [match.id]: "Uploading proof…" }));
      const uploadResponse = await trackLoading(() => uploadMatchProof(proofFile));
      proofImageUrl = uploadResponse?.data?.proof_image_url || null;
      setUploadStates((current) => ({ ...current, [match.id]: "Proof uploaded" }));
    }
    const isPlayerOne = match.current_user_role === "player_one";
    const playerScore = Number(draft.player_score);
    const opponentScore = Number(draft.opponent_score);
    return trackLoading(() =>
      submitMatchResult(match.id, {
        player_one_score: isPlayerOne ? playerScore : opponentScore,
        player_two_score: isPlayerOne ? opponentScore : playerScore,
        proof_image_url: proofImageUrl,
      })
    );
  }

  const activeViewConfig =
    MATCH_VIEWS.find((view) => view.id === activeView) || MATCH_VIEWS[0];
  const actionMatch = pendingDialog?.match;
  const dialogAction = pendingDialog?.actionType;
  const actionableItems = getPendingPlayerActions(actions);
  const competitiveStats = [
    { id: "all", title: "All Matches", value: viewCounts.all || pagination.total || 0, subtitle: "All match workflows", icon: "matches", tone: "primary" },
    { id: "attention", title: "Needs Attention", value: viewCounts.attention || 0, subtitle: "Waiting on your decision", icon: "clock", tone: "warning" },
    { id: "active", title: "Active", value: viewCounts.active || 0, subtitle: "Challenges in progress", icon: "bolt", tone: "secondary" },
    { id: "completed", title: "Completed", value: viewCounts.completed || 0, subtitle: "Officially completed matches", icon: "trophy", tone: "success" },
    { id: "disputed", title: "Disputed", value: viewCounts.disputed || 0, subtitle: "Results under review", icon: "disputes", tone: "danger" },
    { id: "notifications", title: "Pending Actions", value: actionableItems.length, subtitle: "Waiting on your response", icon: "activity", tone: "warning" },
  ];

  function handleTabKeyDown(event, currentViewId) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = MATCH_VIEWS.findIndex((view) => view.id === currentViewId);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? MATCH_VIEWS.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + MATCH_VIEWS.length) % MATCH_VIEWS.length;
    const nextView = MATCH_VIEWS[nextIndex];
    changeView(nextView.id);
    window.requestAnimationFrame(() => document.querySelector(`[data-match-tab="${nextView.id}"]`)?.focus());
  }

  return (
    <DashboardLayout title="My Matches" description="Track every challenge, result, and rivalry." showBackButton={false}>
      <Card as="section" variant="dashboard" className="feature-hero-card match-hero">
        <TrophyWatermark />
        <div>
          <p className="section-label">Match center</p>
          <h2 className="feature-hero-title match-hero-title">
            Every Match. Every Moment. <span>Brag Right.</span>
          </h2>
          <p className="match-hero-copy">
            Review requests, submit results, confirm outcomes, and follow official match status.
          </p>
          <Button as={Link} to="/dashboard/submit-match" variant="challenge" size="sm" className="match-challenge-button">
            <SidebarIcon name="matches" decorative /> Challenge a player
          </Button>
        </div>
        {isLoading ? <MatchSummarySkeleton /> : (
          <div className="status-summary-grid">
            <StatusPill label="Needs Attention" value={viewCounts.attention || 0} tone="pending" icon="disputes" />
            <StatusPill label="Active Matches" value={viewCounts.active || 0} tone="active" icon="matches" />
            <StatusPill label="Completed Matches" value={viewCounts.completed || 0} tone="confirmed" icon="trophy" />
            <StatusPill label="Disputed Matches" value={viewCounts.disputed || 0} tone="disputed" icon="disputes" />
          </div>
        )}
      </Card>

      <PageSection
        className="core-match-actions"
        title="Your match actions"
        description={actionableItems.length ? "Complete these steps to keep your matches moving." : "No match responses or results are waiting on you."}
        actions={<Badge tone={actionableItems.length ? "warning" : "success"}>{actionableItems.length ? `${actionableItems.length} pending` : "All caught up"}</Badge>}
      >
        {actionableItems.length ? (
          <div className="dashboard-review-stack core-match-action-list">
            {actionableItems.map((item) => (
              <Card as="article" variant="dashboard" key={item.id} className="review-item-card core-match-action-card">
                <div className="review-item-copy">
                  <p className="review-item-type">Action required</p>
                  <h3 className="review-item-title">{item.title}</h3>
                  <p className="match-card-meta">{item.message}</p>
                  <time className="review-item-time" dateTime={item.created_at}>
                    {formatMatchDate(item.created_at)}
                  </time>
                </div>
                <Button
                  variant="primary"
                  onClick={() => navigate(buildActionDestination(item))}
                >
                  {getActionItemLabel(item.type)}
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <Card variant="empty">
            <EmptyState
              title="No actions waiting"
              description="New challenges and submitted results will appear here first."
              actionLabel="Challenge a player"
              onAction={() => navigate("/dashboard/submit-match")}
            />
          </Card>
        )}
      </PageSection>

      <SuccessAlert message={feedback.type === "success" ? feedback.message : ""} />
      <ErrorState
        message={feedback.type === "error" ? feedback.message : ""}
        onRetry={() => loadMatches({ forceRefresh: true })}
        retryLabel="Refresh matches"
      />

      {selectedMatchId ? (
        <PageSection title="Selected match" description="Authoritative match details and available actions.">
          {isDetailLoading ? (
            <MatchDetailSkeleton />
          ) : detailError ? (
            <ErrorState
              message={detailError}
              onRetry={() => loadSelectedMatch(selectedMatchId, { forceRefresh: true })}
              retryLabel="Retry match details"
            />
          ) : selectedMatch ? (
            <MatchCenter
                match={selectedMatch}
                currentUserId={user?.id}
                currentUserName={user?.username}
                comparison={rivalry}
                comparisonLoading={isRivalryLoading}
                comparisonError={rivalryError}
                onRetryComparison={() => loadRivalry(selectedMatch.player_one_id, selectedMatch.player_two_id, { forceRefresh: true })}
                actions={hasAvailableMatchActions(selectedMatch) ? (
                  <MatchActions
                    match={selectedMatch}
                    user={user}
                    activeActionKey={activeActionKey}
                    resultDraft={resultDrafts[selectedMatch.id] || EMPTY_DRAFT}
                    proofFile={proofFiles[selectedMatch.id]}
                    proofError={proofErrors[selectedMatch.id]}
                    uploadState={uploadStates[selectedMatch.id]}
                    onDraftChange={changeDraft}
                    onProofChange={selectProof}
                    onAction={requestAction}
                  />
                ) : null}
              />
          ) : null}
        </PageSection>
      ) : null}

      <PageSection
        title="Match views"
        description="Each view is filtered by authoritative backend status and responsibility."
      >
        {isLoading ? (
          <MatchControlsSkeleton />
        ) : (
          <Card variant="information" className="match-view-controls">
            <div className="match-view-tabs" role="tablist" aria-label="Match categories">
              {MATCH_VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="tab"
                  aria-selected={activeView === view.id}
                  tabIndex={activeView === view.id ? 0 : -1}
                  data-match-tab={view.id}
                  className={`match-view-tab${activeView === view.id ? " match-view-tab-active" : ""}`}
                  onClick={() => changeView(view.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, view.id)}
                >
                  <span>{view.label}</span>
                  <Badge tone={view.id === "attention" ? "warning" : view.id === "active" ? "energy" : view.id === "completed" ? "success" : view.id === "disputed" ? "danger" : "neutral"}>
                    {viewCounts[view.id] || 0}
                  </Badge>
                </button>
              ))}
            </div>
          </Card>
        )}

        <div className="match-view-heading">
          <div>
            <h3>{activeViewConfig.label}</h3>
            <p>{activeViewConfig.description}</p>
          </div>
          <span role="status" aria-live="polite">
            {pagination.total} {pagination.total === 1 ? "match" : "matches"}
          </span>
        </div>

        <ErrorState
          message={listError}
          onRetry={() => loadMatches({ forceRefresh: true })}
          retryLabel="Retry matches"
        />

        {isLoading ? (
          <MatchListSkeleton
            rows={Math.min(PAGE_SIZE, 5)}
            label={`Loading ${activeViewConfig.label.toLowerCase()}`}
          />
        ) : matches.length ? (
          <div className={`match-list${isTransitioning ? " loading-region--refreshing" : ""}`} aria-busy={isTransitioning || undefined}>
            {matches.map((match) => (
              <RichMatchCard
                key={match.id}
                match={match}
                currentUserId={user?.id}
                currentUserName={user?.username}
                variant="full"
                isSelected={match.id === selectedMatchId}
                detailPath={`/dashboard/matches?matchId=${encodeURIComponent(match.id)}`}
                actions={
                  <MatchActions
                    match={match}
                    user={user}
                    activeActionKey={activeActionKey}
                    resultDraft={resultDrafts[match.id] || EMPTY_DRAFT}
                    proofFile={proofFiles[match.id]}
                    proofError={proofErrors[match.id]}
                    uploadState={uploadStates[match.id]}
                    onDraftChange={changeDraft}
                    onProofChange={selectProof}
                    onAction={requestAction}
                  />
                }
              />
            ))}
          </div>
        ) : (
          <Card variant="empty">
            <EmptyState
              title={`No ${activeViewConfig.label.toLowerCase()} matches`}
              description="No battles yet. Challenge a player to begin your competitive journey."
              actionLabel="Challenge a player"
              onAction={() => navigate("/dashboard/submit-match")}
            />
          </Card>
        )}

        {pagination.pages > 1 ? (
          <nav className="match-pagination" aria-label="Match pages" aria-busy={isTransitioning || undefined}>
            <Button
              variant="secondary"
              size="sm"
              disabled={isTransitioning || !pagination.has_previous}
              onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))}
            >
              Previous
            </Button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={isTransitioning || !pagination.has_next}
              onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))}
            >
              Next
            </Button>
          </nav>
        ) : null}
      </PageSection>

      <PageSection
        className="match-secondary-summary"
        title="Match statistics"
        description="Status totals and completed-match context."
      >
        {isLoading ? (
          <section className="stat-grid profile-competitive-summary" aria-label="Loading match statistics">
            {competitiveStats.map((stat) => (
              <Card as="article" variant="loading" className="stat-card" key={stat.id} aria-label={`Loading ${stat.title}`}>
                <SectionSkeleton lines={3} />
              </Card>
            ))}
          </section>
        ) : (
          <CompetitiveSummary stats={competitiveStats} label="Match Center statistics" />
        )}
      </PageSection>

      <Modal
        isOpen={Boolean(pendingDialog)}
        onClose={() => !activeActionKey && setPendingDialog(null)}
        eyebrow="Match action"
        title={getDialogTitle(dialogAction)}
        description={getDialogDescription(dialogAction)}
        tone={dialogAction === "confirm" ? "neutral" : "warning"}
        closeOnBackdrop={!activeActionKey}
        actions={
          <>
            <Button variant="ghost" disabled={Boolean(activeActionKey)} onClick={() => setPendingDialog(null)}>
              Keep match unchanged
            </Button>
            <Button
              variant={dialogAction === "confirm" ? "success" : "danger"}
              isLoading={activeActionKey === `${actionMatch?.id}:${dialogAction}`}
              loadingText={getProcessingLabel(dialogAction)}
              onClick={() => executeAction(actionMatch, dialogAction)}
            >
              {getDialogActionLabel(dialogAction)}
            </Button>
          </>
        }
      >
        {pendingDialog && feedback.type === "error" ? (
          <p className="match-dialog-error" role="alert">
            {feedback.message}
          </p>
        ) : null}
        {dialogAction === "dispute" && actionMatch ? (
          <Field
            control={Textarea}
            id={`dispute-${actionMatch.id}`}
            label="Reason for dispute"
            required
            maxLength={500}
            rows={4}
            value={disputeNotes[actionMatch.id] || ""}
            onChange={(event) =>
              setDisputeNotes((current) => ({
                ...current,
                [actionMatch.id]: event.target.value,
              }))
            }
            description="Explain the score or proof issue. An administrator will review this text."
          />
        ) : null}
      </Modal>
    </DashboardLayout>
  );
}

function MatchActions({
  match,
  user,
  activeActionKey,
  resultDraft,
  proofFile,
  proofError,
  uploadState,
  onDraftChange,
  onProofChange,
  onAction,
}) {
  const isBusy = activeActionKey.startsWith(`${match.id}:`);
  if (match.can_accept || match.can_decline) {
    return (
      <div className="match-action-row">
        {match.can_accept ? (
          <Button
            variant="success"
            size="sm"
            isLoading={activeActionKey === `${match.id}:accept`}
            loadingText="Accepting…"
            disabled={isBusy}
            onClick={() => onAction(match, "accept")}
          >
            Accept request
          </Button>
        ) : null}
        {match.can_decline ? (
          <Button variant="danger" size="sm" disabled={isBusy} onClick={() => onAction(match, "decline")}>
            Decline request
          </Button>
        ) : null}
      </div>
    );
  }

  if (match.can_submit_result) {
    return (
      <div className="match-action-stack match-result-form" aria-label="Submit match result">
        <div className="match-score-grid">
          <Field
            id={`score-player-${match.id}`}
            label={`Your score${user?.username ? ` (${user.username})` : ""}`}
            type="number"
            min="0"
            step="1"
            required
            value={resultDraft.player_score}
            disabled={isBusy}
            onChange={(event) => onDraftChange(match.id, "player_score", event.target.value)}
          />
          <Field
            id={`score-opponent-${match.id}`}
            label={`${match.opponent?.username || "Opponent"} score`}
            type="number"
            min="0"
            step="1"
            required
            value={resultDraft.opponent_score}
            disabled={isBusy}
            onChange={(event) => onDraftChange(match.id, "opponent_score", event.target.value)}
          />
        </div>
        <div className="match-proof-input">
          <label htmlFor={`proof-${match.id}`}>Optional proof image</label>
          <input
            id={`proof-${match.id}`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={isBusy}
            aria-describedby={`proof-help-${match.id}${proofError ? ` proof-error-${match.id}` : ""}`}
            onChange={(event) => onProofChange(match.id, event.target.files?.[0] || null)}
          />
          <p id={`proof-help-${match.id}`}>PNG, JPEG, or WebP. The server enforces the configured size limit.</p>
          {proofError ? <p id={`proof-error-${match.id}`} role="alert">{proofError}</p> : null}
          {proofFile ? (
            <div className="match-selected-file">
              <span>{proofFile.name}</span>
              <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => onProofChange(match.id, null)}>
                Remove
              </Button>
            </div>
          ) : null}
          {uploadState ? <p role="status">{uploadState}</p> : null}
        </div>
        <div className="match-action-row">
          <Button
            variant="primary"
            size="sm"
            isLoading={activeActionKey === `${match.id}:submit-result`}
            loadingText={uploadState || "Submitting result…"}
            disabled={isBusy}
            onClick={() => onAction(match, "submit-result")}
          >
            Submit result
          </Button>
          {match.can_cancel ? (
            <Button variant="danger" size="sm" disabled={isBusy} onClick={() => onAction(match, "cancel")}>
              Cancel match
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (match.can_confirm || match.can_dispute) {
    return (
      <div className="match-action-row">
        {match.can_confirm ? (
          <Button variant="success" size="sm" disabled={isBusy} onClick={() => onAction(match, "confirm")}>
            Confirm submitted result
          </Button>
        ) : null}
        {match.can_dispute ? (
          <Button variant="danger" size="sm" disabled={isBusy} onClick={() => onAction(match, "dispute")}>
            Dispute submitted result
          </Button>
        ) : null}
      </div>
    );
  }

  if (match.can_cancel) {
    return (
      <Button variant="danger" size="sm" disabled={isBusy} onClick={() => onAction(match, "cancel")}>
        Cancel match
      </Button>
    );
  }
  return null;
}

function StatusPill({ label, value, tone, icon }) {
  return (
    <div className={`status-pill status-pill-${tone}`} aria-label={`${label}: ${value}`}>
      <span><SidebarIcon name={icon} decorative /> {label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function hasAvailableMatchActions(match) {
  return Boolean(
    match?.can_accept ||
    match?.can_decline ||
    match?.can_submit_result ||
    match?.can_confirm ||
    match?.can_dispute ||
    match?.can_cancel
  );
}

function buildActionDestination(item) {
  const destination = new URL(
    item?.action_url || item?.action_path || "/dashboard/matches",
    window.location.origin
  );
  const matchId = item?.related_match_id || item?.match_id;
  if (matchId && !destination.searchParams.get("matchId")) {
    destination.searchParams.set("matchId", matchId);
  }
  return `${destination.pathname}${destination.search}`;
}

function getActionItemLabel(type) {
  return {
    match_request: "Accept or decline",
    result_required: "Enter result",
    result_submission_required: "Enter result",
    result_awaiting_confirmation: "Review result",
  }[type] || "Review match";
}

function getDialogTitle(action) {
  return {
    decline: "Decline this match request?",
    cancel: "Cancel this match?",
    confirm: "Confirm this submitted result?",
    dispute: "Open a dispute?",
  }[action] || "Confirm match action";
}

function getDialogDescription(action) {
  return {
    decline: "The request will close without creating a confirmed result.",
    cancel: "This match will close and cannot accept a player-submitted result.",
    confirm: "Confirmation makes this result official and updates backend-owned competitive statistics.",
    dispute: "The result will be paused and sent to an administrator for review.",
  }[action] || "Review this action before continuing.";
}

function getDialogActionLabel(action) {
  return {
    decline: "Decline request",
    cancel: "Cancel match",
    confirm: "Confirm result",
    dispute: "Submit dispute",
  }[action] || "Continue";
}

function getProcessingLabel(action) {
  return {
    decline: "Declining…",
    cancel: "Cancelling…",
    confirm: "Confirming…",
    dispute: "Submitting dispute…",
  }[action] || "Processing…";
}
