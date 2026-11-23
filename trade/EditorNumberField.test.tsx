import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EditorNumberField } from './EditorNumberField';

it('keeps incomplete and out-of-range numbers local and commits a valid negative value once', () => {
  const save = vi.fn();
  render(<EditorNumberField label="Across (%)" value={0} min={-100} max={200} onCommit={save} />);
  const input = screen.getByRole('spinbutton');
  fireEvent.input(input, { target: { value: '' } }); fireEvent.blur(input);
  expect(save).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeVisible();
  fireEvent.input(input, { target: { value: '201' } }); fireEvent.blur(input);
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(input, { target: { value: '-2.5' } }); fireEvent.blur(input);
  expect(save).toHaveBeenCalledExactlyOnceWith(-2.5); expect(screen.queryByRole('alert')).toBeNull();
});
it('cancels a draft without changing the saved value and respects a locked field', () => {
  const save = vi.fn(); const props = { label: 'Rotation', value: 15, min: -360, max: 360, onCommit: save };
  const view = render(<EditorNumberField {...props} />);
  const input = screen.getByRole('spinbutton'); input.focus();
  fireEvent.input(input, { target: { value: '90' } }); fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveValue(15); expect(save).not.toHaveBeenCalled();
  view.rerender(<EditorNumberField {...props} disabled />);
  expect(screen.getByRole('spinbutton')).toBeDisabled();
  fireEvent.input(input, { target: { value: '90' } }); fireEvent.blur(input); expect(save).not.toHaveBeenCalled();
});
it('commits Enter once and follows a later undo value', () => {
  const save = vi.fn(); const props = { label: 'Width', value: 20, min: 5, max: 1000, onCommit: save };
  const view = render(<EditorNumberField {...props} />);
  const input = screen.getByRole('spinbutton'); input.focus();
  fireEvent.input(input, { target: { value: '30' } }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(save).toHaveBeenCalledExactlyOnceWith(30);
  view.rerender(<EditorNumberField {...props} value={10} />);
  expect(screen.getByRole('spinbutton')).toHaveValue(10);
});
