export default function InitialAppLoader() {
  return (
    <main className="initial-app-loader" aria-busy="true">
      <div className="initial-app-loader__content" role="status" aria-live="polite">
        <span className="initial-app-loader__mark" aria-hidden="true">BR</span>
        <div>
          <strong>BragRight</strong>
          <span>Restoring your arena</span>
        </div>
        <span className="initial-app-loader__indicator" aria-hidden="true" />
      </div>
    </main>
  );
}
