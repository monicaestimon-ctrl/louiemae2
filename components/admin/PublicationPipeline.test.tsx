import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublicationPipeline from './PublicationPipeline';

const mocks = vi.hoisted(() => ({ status: 'CanLoadMore', ids: ['one', 'two'], loadMore: vi.fn() }));
vi.mock('convex/react', () => ({ usePaginatedQuery: (_ref: unknown, args: { stage: string }) =>
  args.stage === 'imported_draft'
    ? { results: mocks.ids.map(_id => ({ _id })), status: mocks.status, loadMore: mocks.loadMore }
    : { results: [], status: 'Exhausted', loadMore: vi.fn() },
}));
beforeEach(() => { mocks.status = 'CanLoadMore'; mocks.ids = ['one', 'two']; vi.clearAllMocks(); });
afterEach(cleanup);

it('labels partial counts and lets the operator continue to an exact total', () => {
  const view = render(<PublicationPipeline />);
  expect(screen.getByText('Imported drafts: At least 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Count more imported drafts' }));
  expect(mocks.loadMore).toHaveBeenCalledWith(100);
  mocks.status = 'LoadingMore'; view.rerender(<PublicationPipeline />);
  expect(screen.getByRole('status')).toHaveTextContent('Counting more');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  mocks.ids = Array.from({ length: 803 }, (_, i) => String(i));
  mocks.status = 'Exhausted'; view.rerender(<PublicationPipeline />);
  expect(screen.getByText('Imported drafts: 803')).toBeInTheDocument();
  expect(screen.getByText('Published: 0')).toBeInTheDocument();
});

it('does not report zero while loading or double-count repeated identities', () => {
  mocks.status = 'LoadingFirstPage'; mocks.ids = [];
  const view = render(<PublicationPipeline />);
  expect(screen.getByText('Imported drafts: Loading…')).toBeInTheDocument();
  mocks.status = 'Exhausted'; mocks.ids = ['one', 'one', 'two'];
  view.rerender(<PublicationPipeline />);
  const row = screen.getByText('Imported drafts: 2').closest('li')!;
  expect(within(row).queryByRole('button')).not.toBeInTheDocument();
});
