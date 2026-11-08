import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';
import { STANDARD_ACCESS, addressKey } from '../../lib/delivery/destination';
import { serviceTerms } from '../../lib/delivery/service';

const request = vi.hoisted(() => vi.fn());
vi.mock('convex/react', () => ({ useMutation: () => request }));
vi.mock('./DeliveryQuoteStatus', () => ({ default: () => <p>Request saved</p> }));

describe('delivery access handoff', () => {
  it('preserves full address and access through a failed request and retry', async () => {
    request
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ id: 'request1' });
    const address = {
      recipientName: 'Ada Customer',
      phone: '2095550100',
      line1: '12 Main',
      line2: 'Suite 3',
      city: 'Stockton',
      state: 'CA',
      postalCode: '95206',
      country: 'US',
      access: { ...STANDARD_ACCESS, requestedService: 'inside' as const, stairs: true },
    };
    render(
      <DeliveryQuoteRequest
        lines={[{ productId: 'p', variantId: 'v', packs: 2 }]}
        postalCode="95206"
        address={address}
        initialEmail="ada@example.com"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Request a delivery quote' }));
    expect(screen.getByLabelText('Quote contact name')).toHaveValue('Ada Customer');
    expect(screen.getByLabelText('Quote contact email')).toHaveValue('ada@example.com');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Send delivery request' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send delivery request' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send delivery request' }));
    await screen.findByText('Request saved');
    expect(request.mock.calls[0][0]).toMatchObject({ address, service: 'inside' });
    expect(request.mock.calls[1][0]).toEqual(request.mock.calls[0][0]);
  });
  it('invalidates an address signature when access or recipient changes', () => {
    const address = {
      recipientName: 'A',
      line1: '1 Main',
      city: 'Stockton',
      state: 'CA',
      postalCode: '95206',
      country: 'US',
      access: STANDARD_ACCESS,
    };
    expect(addressKey(address)).not.toBe(
      addressKey({ ...address, access: { ...STANDARD_ACCESS, stairs: true } })
    );
    expect(addressKey(address)).not.toBe(addressKey({ ...address, recipientName: 'B' }));
  });
  it('uses approved mode wording and requires confirmation for unknown modes', () => {
    const policy = {
      code: 'curbside',
      modes: {
        ground: { label: 'Parcel delivery', details: ['Parcel placement'], evidenceRef: 'fixture' },
        ltl: { label: 'Curbside freight', details: ['No assembly'], evidenceRef: 'fixture' },
      },
    };
    expect(serviceTerms(['ground', 'ltl', 'ground'], policy)).toMatchObject({
      label: 'Parcel delivery + Curbside freight',
      details: ['Parcel placement', 'No assembly'],
    });
    expect(serviceTerms(['per_item'], policy).label).toBe('Delivery quote required');
  });
});
