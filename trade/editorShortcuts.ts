/** Native inertness does not disable window-level editor keyboard listeners. */
export function editorShortcutsBlocked(event: Pick<KeyboardEvent, 'defaultPrevented'>, doc: Document = document) {
  const active = doc.activeElement;
  return event.defaultPrevented || Boolean(doc.querySelector('dialog[open]'))
    || Boolean(active?.matches('input, textarea, select'))
    || (active instanceof HTMLElement && active.isContentEditable === true);
}
