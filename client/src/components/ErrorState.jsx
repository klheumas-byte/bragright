export default function ErrorState({
  message,
  onRetry,
  retryLabel = "Retry",
  className = "",
}) {
  if (!message) {
    return null;
  }

  return (
    <div className={`match-feedback match-feedback-error feedback-state ${className}`.trim()}>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="inline-action-button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
