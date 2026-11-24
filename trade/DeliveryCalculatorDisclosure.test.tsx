import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const tool = vi.hoisted(() => vi.fn());
vi.mock('./deferredFeatures', () => ({ TradeDeliveryCalculator: () => { tool(); return <input aria-label="Destination ZIP" defaultValue="" />; } }));
import { DeliveryCalculatorDisclosure } from './DeliveryCalculatorDisclosure';
afterEach(() => { cleanup(); tool.mockReset(); });
it('loads only after opening and preserves entered values across collapse', () => {
  render(<DeliveryCalculatorDisclosure />);
  expect(tool).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open delivery calculator' }));
  fireEvent.change(screen.getByLabelText('Destination ZIP'), { target: { value: '90210' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hide delivery calculator' }));
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open delivery calculator' }));
  expect(screen.getByRole('textbox')).toHaveValue('90210');
});
