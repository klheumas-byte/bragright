import { forwardRef } from "react";

const Card = forwardRef(function Card(
  {
    as: Component = "section",
    children,
    className = "",
    variant = "information",
    padded = false,
    ...props
  },
  ref
) {
  const classes = [
    "ui-card",
    `ui-card--${variant}`,
    padded ? "ui-card--padded" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component ref={ref} className={classes} {...props}>
      {children}
    </Component>
  );
});

export default Card;
