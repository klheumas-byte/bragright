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
    <Alert
      tone="error"
      className={`match-feedback match-feedback-error feedback-state ${className}`.trim()}
      action={
        onRetry ? (
          <Button
            variant="secondary"
            size="sm"
            className="inline-action-button"
            onClick={onRetry}
          >
            {retryLabel}
          </Button>
        ) : null
      }
    >
      {message}
    </Alert>
  );
}
import { Alert, Button } from "./ui";
