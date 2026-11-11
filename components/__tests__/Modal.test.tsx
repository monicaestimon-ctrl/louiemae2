import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';
afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});
it('closes only the topmost controlled dialog and preserves the outer scroll lock', () => {
  document.body.style.overflow = 'scroll';
  const outerClose = vi.fn();
  const innerClose = vi.fn();
  function Example() {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(false);
    return (
      <Modal
        open={outer}
        label="Outer"
        onClose={() => {
          outerClose();
          setOuter(false);
        }}
      >
        <button onClick={() => setInner(true)}>Open inner</button>
        <Modal
          open={inner}
          label="Inner"
          onClose={() => {
            innerClose();
            setInner(false);
          }}
        >
          <button>Inner control</button>
        </Modal>
      </Modal>
    );
  }
  const view = render(<Example />);
  fireEvent.click(screen.getByRole('button', { name: 'Open inner' }));
  fireEvent(
    screen.getByRole('dialog', { name: 'Inner' }),
    new Event('cancel', { bubbles: true, cancelable: true })
  );
  expect(innerClose).toHaveBeenCalledOnce();
  expect(outerClose).not.toHaveBeenCalled();
  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull();
  fireEvent(
    screen.getByRole('dialog', { name: 'Outer' }),
    new Event('cancel', { cancelable: true })
  );
  expect(outerClose).toHaveBeenCalledOnce();
  expect(document.body.style.overflow).toBe('scroll');
  view.unmount();
  expect(document.body.style.overflow).toBe('scroll');
});
it('restores the original scroll style when a route unmounts open dialogs', () => {
  document.body.style.overflow = 'auto';
  const view = render(
    <React.StrictMode>
      <Modal open label="Menu" onClose={vi.fn()}>
        <button>Close</button>
      </Modal>
    </React.StrictMode>
  );
  expect(document.body.style.overflow).toBe('hidden');
  view.unmount();
  expect(document.body.style.overflow).toBe('auto');
  expect(document.querySelector('dialog')).toBeNull();
});

it('focuses the requested control, wraps Tab in both directions and restores the trigger', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as ReturnType<
    HTMLElement['getClientRects']
  >);
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open details</button>
        <Modal open={open} label="Details" onClose={() => setOpen(false)} initialFocus="#preferred">
          <button>First</button>
          <button id="preferred">Preferred</button>
          <button onClick={() => setOpen(false)}>Last</button>
        </Modal>
      </>
    );
  }
  render(<Example />);
  const trigger = screen.getByRole('button', { name: 'Open details' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'Preferred' })).toHaveFocus();
  const first = screen.getByRole('button', { name: 'First' });
  const last = screen.getByRole('button', { name: 'Last' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  await act(async () => {
    fireEvent.click(last);
  });
  expect(trigger).toHaveFocus();
});

it('does not wrap before a trailing iframe', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as ReturnType<
    HTMLElement['getClientRects']
  >);
  render(
    <Modal open label="Frame fixture" onClose={vi.fn()}>
      <button>Before frame</button>
      <iframe title="Local test frame" />
    </Modal>
  );
  const before = screen.getByRole('button', { name: 'Before frame' });
  expect(before).toHaveFocus();
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  fireEvent(before, tab);
  expect(tab.defaultPrevented).toBe(false);
});
