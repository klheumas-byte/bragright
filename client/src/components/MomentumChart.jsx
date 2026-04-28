// MomentumChart is a chart-ready component.
// For now it renders a polished static placeholder, but its data shape can later come from Flask.
export default function MomentumChart({ title, subtitle, data = [] }) {
  const hasData = data.length > 0;
  const highestValue = hasData ? Math.max(...data.map((point) => point.value)) : 0;

  return (
    <section className="dashboard-panel momentum-panel" aria-labelledby="momentum-chart-title">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Performance Trend</p>
          <h2 className="panel-title" id="momentum-chart-title">
            {title}
          </h2>
        </div>
        <p className="panel-subtitle">{subtitle}</p>
      </div>

      {hasData ? (
        <div className="momentum-chart" aria-label="Weekly momentum chart placeholder">
          {data.map((point) => {
            const barHeight = `${Math.round((point.value / highestValue) * 100)}%`;

            return (
              <div
                className="momentum-column"
                key={point.id}
                aria-label={`${point.label}: ${point.value} momentum score`}
              >
                <div className="momentum-track" aria-hidden="true">
                  <div className="momentum-bar" style={{ height: barHeight }} />
                </div>
                <span className="momentum-label">{point.label}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="momentum-empty-state">
          Momentum data will appear here once match activity is available.
        </div>
      )}
    </section>
  );
}
