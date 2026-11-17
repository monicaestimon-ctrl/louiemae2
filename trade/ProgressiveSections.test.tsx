import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProgressiveSections } from './ProgressiveSections';

type FrameCallback = (time: number) => void;
type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('yields between sections and preserves an already edited field while revealing the rest', () => {
  const frames: FrameCallback[] = [];
  const idle: IdleCallback[] = [];
  const first = vi.fn(() => <input aria-label="Project" />);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestIdleCallback', (callback: IdleCallback) => idle.push(callback));
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  render(
    <ProgressiveSections
      sections={[
        { id: 'form', render: first },
        { id: 'rooms', render: () => <h2>Rooms</h2> },
        { id: 'footer', render: () => <footer>Support</footer> },
      ]}
    />
  );
  const input = screen.getByLabelText('Project');
  fireEvent.change(input, { target: { value: 'My room' } });
  expect(screen.queryByText('Rooms')).toBeNull();
  act(() => frames.shift()!(0));
  expect(screen.queryByText('Rooms')).toBeNull();
  act(() => idle.shift()!({ didTimeout: false, timeRemaining: () => 10 }));
  expect(screen.getByText('Rooms')).toBeInTheDocument();
  expect(screen.queryByText('Support')).toBeNull();
  act(() => frames.shift()!(0));
  act(() => idle.shift()!({ didTimeout: true, timeRemaining: () => 0 }));
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByLabelText('Project')).toBe(input);
  expect(input).toHaveValue('My room');
  expect(first).toHaveBeenCalledTimes(1);
});

it('cancels scheduled work when leaving the page, including the timer fallback', () => {
  vi.useFakeTimers();
  let frame: FrameCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestIdleCallback', undefined);
  const later = vi.fn(() => <div>Later</div>);
  const view = render(
    <ProgressiveSections
      sections={[
        { id: 'first', render: () => <div>First</div> },
        { id: 'later', render: later },
      ]}
    />
  );
  act(() => frame!(0));
  view.unmount();
  act(() => vi.runAllTimers());
  expect(later).not.toHaveBeenCalled();
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
});
