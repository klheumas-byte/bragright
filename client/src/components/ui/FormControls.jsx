import { forwardRef, useId } from "react";

export function FormField({
  children,
  label,
  htmlFor,
  required = false,
  description,
  error,
  className = "",
}) {
  return (
    <div className={`ui-form-field ${className}`.trim()}>
      {label ? (
        <label className="ui-form-field__label" htmlFor={htmlFor}>
          <span>{label}</span>
          {required ? (
            <span className="ui-required-indicator" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {description && !error ? (
        <p id={`${htmlFor}-description`} className="ui-form-field__description">
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          className="ui-validation-message"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function useControlAccessibility({
  id,
  name,
  description,
  error,
  required,
  "aria-describedby": ariaDescribedBy,
  ...props
}) {
  const generatedId = useId();
  const controlId = id || name || generatedId;
  const describedBy = [
    ariaDescribedBy,
    description && !error ? `${controlId}-description` : "",
    error ? `${controlId}-error` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    controlId,
    controlProps: {
      ...props,
      id: controlId,
      name,
      required,
      "aria-required": required || undefined,
      "aria-invalid": Boolean(error) || undefined,
      "aria-describedby": describedBy || undefined,
    },
  };
}

export const Input = forwardRef(function Input(
  { className = "", description, error, required, ...props },
  ref
) {
  const { controlProps } = useControlAccessibility({
    ...props,
    description,
    error,
    required,
  });
  return (
    <input
      ref={ref}
      className={`ui-input ${className}`.trim()}
      {...controlProps}
    />
  );
});

export const SearchInput = forwardRef(function SearchInput(props, ref) {
  return <Input ref={ref} type="search" {...props} />;
});

export const DateInput = forwardRef(function DateInput(props, ref) {
  return <Input ref={ref} type="date" {...props} />;
});

export const Select = forwardRef(function Select(
  { children, className = "", description, error, required, ...props },
  ref
) {
  const { controlProps } = useControlAccessibility({
    ...props,
    description,
    error,
    required,
  });
  return (
    <select
      ref={ref}
      className={`ui-select ${className}`.trim()}
      {...controlProps}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea(
  { className = "", description, error, required, ...props },
  ref
) {
  const { controlProps } = useControlAccessibility({
    ...props,
    description,
    error,
    required,
  });
  return (
    <textarea
      ref={ref}
      className={`ui-textarea ${className}`.trim()}
      {...controlProps}
    />
  );
});

function Choice({
  type,
  label,
  className = "",
  inputClassName = "",
  ...props
}) {
  return (
    <label className={`ui-choice ${className}`.trim()}>
      <input
        className={`ui-${type}-control ${inputClassName}`.trim()}
        type={type}
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

export function Checkbox(props) {
  return <Choice type="checkbox" {...props} />;
}

export function Radio(props) {
  return <Choice type="radio" {...props} />;
}

export function Switch({ label, className = "", ...props }) {
  return (
    <label className={`ui-switch ${className}`.trim()}>
      <input
        className="ui-switch-control"
        type="checkbox"
        role="switch"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

export function Field({
  label,
  description,
  error,
  required,
  control: Control = Input,
  id,
  name,
  ...controlProps
}) {
  const generatedId = useId();
  const controlId = id || name || generatedId;
  return (
    <FormField
      label={label}
      htmlFor={controlId}
      required={required}
      description={description}
      error={error}
    >
      <Control
        {...controlProps}
        id={controlId}
        name={name}
        required={required}
        description={description}
        error={error}
      />
    </FormField>
  );
}
