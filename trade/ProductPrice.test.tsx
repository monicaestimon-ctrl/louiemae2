import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductPrice } from './ProductPrice';
import { formatHolmPrice } from './formatHolmPrice';
describe('approved product price presentation', () => {
  it('uses actual approved retail and trade amounts without a derived discount', () => {
    const view = render(<ProductPrice p={{ price: 199, trade: 189.05 }} mode="trade" />);
    expect(view.container.textContent).toBe('$189.05 $199');
    expect(view.container.querySelector('s')?.textContent).toBe('$199');
  });
  it('keeps retail mode free of a trade comparison', () => {
    const view = render(<ProductPrice p={{ price: 199, trade: 150 }} />);
    expect(view.container.textContent).toBe('$199.00');
    expect(view.container.querySelector('s')).toBeNull();
  });
  it('preserves the existing null-trade presentation without inventing savings', () => {
    const view = render(<ProductPrice p={{ price: 199, trade: null }} mode="trade" />);
    expect(view.container.textContent).toBe('$199.00 $199');
  });
  it('multiplies the supplied price by quantity and retains the existing whole-dollar display', () => {
    const view = render(<ProductPrice p={{ price: 199, trade: 189.05 }} mode="trade" qty={3} />);
    expect(view.container.textContent).toBe('$567 $597');
  });
  it('keeps large presentation free of the comparison line', () => {
    const view = render(<ProductPrice p={{ price: 199, trade: 189.05 }} mode="trade" big />);
    expect(view.container.textContent).toBe('$189');
    expect(view.container.querySelector('s')).toBeNull();
  });
  it('shows unavailable non-finite amounts without displaying a false zero', () => {
    render(<ProductPrice p={{ price: NaN, trade: null }} />);
    expect(screen.getByText('Review unavailable items')).toBeInTheDocument();
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite display value %s', (value) => {
    expect(formatHolmPrice(value)).toBe('Review unavailable items');
  });
  it('retains explicit zero and cents when requested', () => {
    expect(formatHolmPrice(0, true)).toBe('$0.00');
    expect(formatHolmPrice(1234.5, true)).toBe('$1,234.50');
  });
});

it('shows current trade pricing without an unavailable struck-through retail comparison', () => {
  const view = render(<ProductPrice p={{ price: Number.NaN, trade: 90 }} mode="trade" />);
  expect(view.container.textContent).toContain('$90.00');
  expect(view.container.querySelector('s')).toBeNull();
});
