import React, { createRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('convex/react', () => ({ useAction: () => generate, useQuery: () => null }));
import { DetailsAndStory, type DetailsAndStoryActions } from './DetailsAndStory';
afterEach(cleanup);
it('uses the shared request and failure guard for mobile shortcuts', async () => {
    generate.mockResolvedValue({ ok: true, description: 'Limited draft', warnings: ['AI access suspended'], fallbackUsed: true,
        validation: { passed: false }, providerErrorCode: 'PROVIDER_SUSPENDED', providerRetryable: false });
    const actions = createRef<DetailsAndStoryActions>(); const change = vi.fn();
    render(<DetailsAndStory actionsRef={actions} value={{ name: 'Dress', description: 'Existing story' }} context={{ collection: 'kids' }}
        selection={{ images: ['https://example.com/green.jpg'], variants: [{ name: 'Green 90cm' }], subset: true }} onChange={change} />);
    await act(async () => { actions.current!.generateDescription(); });
    await screen.findByRole('button', { name: 'Use this draft' });
    expect(generate.mock.calls[0][0].request.selection).toMatchObject({ subset: true, variants: [{ name: 'Green 90cm' }] });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Smart Description' })).toBeDisabled();
    await act(async () => { actions.current!.generateDescription(); });
    expect(generate).toHaveBeenCalledTimes(1);
});
