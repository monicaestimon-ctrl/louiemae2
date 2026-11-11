import './modal.css';
import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

type ModalProps = {
  open: boolean;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  initialFocus?: string;
};
const stacks = new WeakMap<
  Document,
  { dialogs: HTMLDialogElement[]; overflow: string; overflowPriority: string }
>();
const focusSelector =
  'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),iframe,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
/** Find current visible controls, including controls added by asynchronous content. */
function focusable(dialog: HTMLDialogElement) {
  return [...dialog.querySelectorAll<HTMLElement>(focusSelector)].filter(
    (node) =>
      node.tabIndex >= 0 &&
      !node.closest('[inert]') &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== 'hidden'
  );
}
/** Native modal with controlled dismissal, nested focus restoration and shared scroll ownership. */
export function Modal({
  open,
  label,
  onClose,
  children,
  className = '',
  initialFocus,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const doc = dialog.ownerDocument;
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    let stack = stacks.get(doc);
    if (!stack) {
      stack = {
        dialogs: [],
        overflow: doc.body.style.overflow,
        overflowPriority: doc.body.style.getPropertyPriority('overflow'),
      };
      stacks.set(doc, stack);
      doc.body.style.setProperty('overflow', 'hidden', 'important');
    }
    stack.dialogs.push(dialog);
    dialog.showModal();
    const preferred = initialFocus
      ? dialog.querySelector<HTMLElement>(initialFocus)
      : dialog.querySelector<HTMLElement>('[data-modal-initial-focus]');
    (preferred ?? focusable(dialog)[0])?.focus({ preventScroll: true });
    return () => {
      const wasTop = stack.dialogs.at(-1) === dialog;
      stack.dialogs = stack.dialogs.filter((item) => item !== dialog);
      if (dialog.open) dialog.close();
      if (!stack.dialogs.length) {
        doc.body.style.setProperty('overflow', stack.overflow, stack.overflowPriority);
        stacks.delete(doc);
      }
      if (!wasTop) return;
      window.queueMicrotask(() => {
        // Resolve after React finishes removing route content and opening any successor.
        const top = stacks.get(doc)?.dialogs.at(-1);
        const visible = (node: HTMLElement | null): node is HTMLElement =>
          Boolean(
            node?.isConnected &&
            node !== doc.body &&
            node.getClientRects().length &&
            !node.closest('[inert],dialog:not([open])')
          );
        const fallback = [
          ...doc.querySelectorAll<HTMLElement>('[data-modal-return-focus], #main-content'),
        ].find(visible);
        const target =
          visible(previous) && (!top || top.contains(previous))
            ? previous
            : top
              ? focusable(top)[0]
              : fallback;
        target?.focus({ preventScroll: true });
      });
    };
  }, [open, initialFocus]);
  // Loading/error transitions may remove the focused control without closing the modal.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (
      !open ||
      !dialog ||
      stacks.get(dialog.ownerDocument)?.dialogs.at(-1) !== dialog ||
      dialog.contains(dialog.ownerDocument.activeElement)
    )
      return;
    (
      dialog.querySelector<HTMLElement>(initialFocus ?? '[data-modal-initial-focus]') ??
      focusable(dialog)[0]
    )?.focus({ preventScroll: true });
  });
  if (!open) return null;
  return createPortal(
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={`lm-modal ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (stacks.get(event.currentTarget.ownerDocument)?.dialogs.at(-1) === event.currentTarget)
          close.current();
      }}
      onKeyDown={(event) => {
        const dialog = event.currentTarget;
        // Modal controls handle their own keys; inert background pages must not receive shortcuts.
        event.stopPropagation();
        // Native cancel owns Escape and still runs because its default is not prevented.
        if (event.key === 'Escape') return;
        if (event.key !== 'Tab' || stacks.get(dialog.ownerDocument)?.dialogs.at(-1) !== dialog)
          return;
        const controls = focusable(dialog);
        const first = controls[0];
        const last = controls.at(-1);
        const active = dialog.ownerDocument.activeElement;
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (active === last || !controls.includes(active as HTMLElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
    </dialog>,
    document.body
  );
}
