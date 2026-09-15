import { useEffect, useRef, type ReactNode } from 'react';

/** A modal owns keyboard focus until it closes, then returns focus to its trigger. */
export function Modal({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = node.parentElement;
    const siblings = Array.from(backdrop?.parentElement?.children ?? [])
      .filter(
        (sibling): sibling is HTMLElement => sibling instanceof HTMLElement && sibling !== backdrop,
      )
      .map((sibling) => ({ sibling, inert: sibling.inert }));
    for (const { sibling } of siblings) sibling.inert = true;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]'),
      ).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.hasAttribute('disabled') &&
          element.getClientRects().length > 0,
      );
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        node.focus();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', key);
    (focusable()[0] ?? node).focus();
    return () => {
      node.removeEventListener('keydown', key);
      for (const { sibling, inert } of siblings) sibling.inert = inert;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}
