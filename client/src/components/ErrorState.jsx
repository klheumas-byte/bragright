import { useState } from "react";
import { Alert, Button } from "./ui";

export default function ErrorState({
  message,
  onRetry,
  retryLabel = "Retry",
  className = "",
}) {
  const [isRetrying, setIsRetrying] = useState(false);

  if (!message) {
    return null;
  }

  async function handleRetry() {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
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
            onClick={handleRetry}
            isLoading={isRetrying}
            loadingText="Retrying…"
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
