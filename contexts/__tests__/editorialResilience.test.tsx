import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteProvider } from '../BlogContext';
import { BlogPage } from '../../components/BlogPage';
import { BlogPostView } from '../../components/BlogPostView';

const mocks = vi.hoisted(() => ({ result: undefined as unknown, mutate: vi.fn() }));
vi.mock('convex/react', () => ({
  useQueries: () => ({ posts: mocks.result }),
  useQuery: () => null,
  useMutation: () => mocks.mutate,
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock('../NewsletterContext', () => ({ useNewsletter: () => ({ addSubscriber: vi.fn() }) }));
vi.mock('../../components/FadeIn', () => ({ FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

function Shell() {
  return <><nav aria-label="Shopping">Shop</nav><BlogPage /></>;
}
beforeEach(() => { mocks.result = undefined; mocks.mutate.mockClear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('optional public editorial isolation', () => {
  it('keeps shopping navigation mounted when the blog query fails without exposing private errors', () => {
    mocks.result = new Error('private backend diagnostic');
    render(<SiteProvider><Shell /></SiteProvider>);
    expect(screen.getByRole('navigation', { name: 'Shopping' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('temporarily unavailable');
    expect(screen.queryByText('private backend diagnostic')).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('bounds pending UI to ten seconds and recovers when the subscription returns', () => {
    const view = render(<SiteProvider><Shell /></SiteProvider>);
    expect(screen.getByText('Loading stories…')).toBeTruthy();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('status').textContent).toContain('temporarily unavailable');
    mocks.result = [];
    view.rerender(<SiteProvider><Shell /></SiteProvider>);
    expect(screen.getByText('New stories are coming soon.')).toBeTruthy();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('does not call a pending or failed article missing', () => {
    const view = render(<SiteProvider><BlogPostView postId="unknown" /></SiteProvider>);
    expect(screen.getByRole('heading').textContent).toBe('Loading story…');
    mocks.result = new Error('offline');
    view.rerender(<SiteProvider><BlogPostView postId="unknown" /></SiteProvider>);
    expect(screen.getByRole('heading').textContent).toBe('Story temporarily unavailable');
    mocks.result = [];
    view.rerender(<SiteProvider><BlogPostView postId="unknown" /></SiteProvider>);
    expect(screen.getByRole('heading').textContent).toBe('Post not found');
  });
});
