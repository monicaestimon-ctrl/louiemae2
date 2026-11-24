import { afterEach, expect, it } from 'vitest';
import { editorShortcutsBlocked } from './editorShortcuts';
afterEach(() => { document.body.replaceChildren(); });
it('blocks background editor commands while any native dialog is open', () => {
  document.body.innerHTML = '<button id="canvas">Canvas action</button><dialog open><button>Dialog action</button></dialog>';
  (document.querySelector('dialog button') as HTMLButtonElement).focus();
  expect(editorShortcutsBlocked({ defaultPrevented: false })).toBe(true);
  document.querySelector('dialog')!.removeAttribute('open');
  document.getElementById('canvas')!.focus();
  expect(editorShortcutsBlocked({ defaultPrevented: false })).toBe(false);
  expect(editorShortcutsBlocked({ defaultPrevented: true })).toBe(true);
});
it('leaves field keyboard behavior to the focused field', () => {
  document.body.innerHTML = '<input><textarea></textarea><select><option>Choice</option></select>';
  for (const field of document.querySelectorAll<HTMLElement>('input,textarea,select')) {
    field.focus(); expect(editorShortcutsBlocked({ defaultPrevented: false })).toBe(true);
  }
});
