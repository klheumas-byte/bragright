export default function SuccessAlert({ message, className = "" }) {
  if (!message) {
    return null;
  }

  return (
    <div className={`match-feedback match-feedback-success ${className}`.trim()}>
      <p>{message}</p>
    </div>
  );
}
