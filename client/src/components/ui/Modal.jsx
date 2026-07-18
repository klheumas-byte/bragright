import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export default function Modal({
  isOpen,
  onClose,
  eyebrow,
  title,
  description,
  titleClassName = "",
  descriptionClassName = "",
  children,
  actions,
  size = "md",
  tone = "neutral",
  scrollable = false,
  closeOnBackdrop = true,
  className = "",
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const previousBodyOverflowRef = useRef("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = description ? `${generatedId}-description` : undefined;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement;
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector(FOCUSABLE_SELECTOR);
    (firstFocusable || dialog)?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !dialog) {
        return;
      }
      const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflowRef.current;
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="ui-modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={`ui-modal ui-modal--${size} ui-modal--${tone} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="ui-modal__header">
          {eyebrow ? <p className="panel-kicker">{eyebrow}</p> : null}
          <h2 id={titleId} className={titleClassName}>
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className={descriptionClassName}>
              {description}
            </p>
          ) : null}
        </header>
        {children ? (
          <div
            className={`ui-modal__body${
              scrollable ? " ui-modal__body--scrollable" : ""
            }`}
          >
            {children}
          </div>
        ) : null}
        {actions ? <footer className="ui-modal__actions">{actions}</footer> : null}
      </div>
    </div>,
    document.body
  );
}
