interface Props {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

export default function LoadingIndicator({ label, size = "md", className = "" }: Props) {
  return (
    <span className={`loading-inline ${className}`.trim()} role="status" aria-live="polite">
      <span className={`spinner spinner-${size}`} aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}
