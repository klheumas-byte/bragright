import { useId } from "react";

export default function PageSection({
  as: Component = "section",
  title,
  description,
  actions,
  children,
  className = "",
  titleId,
}) {
  const generatedId = useId();
  const resolvedTitleId = titleId || `${generatedId}-title`;
  return (
    <Component
      className={`ui-page-section ${className}`.trim()}
      aria-labelledby={title ? resolvedTitleId : undefined}
    >
      {title || description || actions ? (
        <header className="ui-page-section__header">
          <div className="ui-page-section__copy">
            {title ? <h2 id={resolvedTitleId}>{title}</h2> : null}
            {description ? (
              <p className="ui-page-section__description">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </Component>
  );
}
