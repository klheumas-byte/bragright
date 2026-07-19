import { forwardRef } from "react";

const VALID_VARIANTS = new Set([
  "primary",
  "secondary",
  "outline",
  "ghost",
  "danger",
  "success",
  "challenge",
  "premium",
]);

const Button = forwardRef(function Button(
  {
    as: Component = "button",
    children,
    className = "",
    variant = "primary",
    size = "md",
    isLoading = false,
    loadingText = "Working…",
    iconOnly = false,
    disabled = false,
    type,
    ...props
  },
  ref
) {
  const safeVariant = VALID_VARIANTS.has(variant) ? variant : "primary";
  const classes = [
    "ui-button",
    `ui-button--${safeVariant}`,
    size !== "md" ? `ui-button--${size}` : "",
    iconOnly ? "ui-button--icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const componentProps = {
    ...props,
    ref,
    className: classes,
    "aria-busy": isLoading || undefined,
    "aria-label": isLoading ? loadingText : props["aria-label"],
  };

  if (Component === "button") {
    componentProps.type = type || "button";
    componentProps.disabled = disabled || isLoading;
  } else if (disabled || isLoading) {
    componentProps["aria-disabled"] = "true";
    componentProps.tabIndex = -1;
    componentProps.onClick = (event) => event.preventDefault();
  }

  return (
    <Component {...componentProps}>
      <span className="ui-button__content" aria-hidden={isLoading || undefined}>
        {children}
      </span>
      {isLoading ? (
        <span className="ui-button__loading" role="status">
          <span className="ui-button__spinner" aria-hidden="true" />
          <span>{loadingText}</span>
        </span>
      ) : null}
    </Component>
  );
});

export default Button;
