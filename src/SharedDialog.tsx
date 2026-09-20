import { useEffect, useRef, type ReactNode, type RefObject } from "react";

interface SharedDialogProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  labelledBy: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function SharedDialog({
  open,
  onClose,
  className = "",
  labelledBy,
  initialFocusRef,
  children,
}: SharedDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => initialFocusRef?.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [initialFocusRef, open]);

  return (
    <dialog
      ref={dialogRef}
      className={`modal ${className}`.trim()}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export function InlineState({
  message,
  error = false,
  onRetry,
}: {
  message: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`inline-state${error ? " error-state" : ""}`} role="status">
      <span>{message}</span>
      {onRetry ? (
        <>
          {" "}
          <button className="details-button" type="button" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : null}
    </div>
  );
}
