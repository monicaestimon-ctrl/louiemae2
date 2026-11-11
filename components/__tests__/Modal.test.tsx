import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';
afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
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
