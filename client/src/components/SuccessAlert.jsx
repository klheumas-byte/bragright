import { Alert } from "./ui";

export default function SuccessAlert({ message, className = "" }) {
  if (!message) {
    return null;
  }

  return (
    <Alert
      tone="success"
      className={`match-feedback match-feedback-success ${className}`.trim()}
    >
      {message}
    </Alert>
  );
}
