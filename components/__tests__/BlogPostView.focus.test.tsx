import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BlogPostView } from '../BlogPostView';
const query = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/useRecoverableQuery', () => ({ useRecoverableQuery: query }));
const post = {
  _id: 'story1',
  title: 'A thoughtful home',
  excerpt: 'A readable story.',
  image: '',
  category: 'Home',
  date: 'November 18, 2026',
  contentHtml: '<p>A settled reading surface.</p>',
};
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  query.mockReset();
});
it('preserves initial document focus in StrictMode and does not animate reading content', () => {
  document.body.innerHTML =
    '<main id="lm-journal-document" data-post-id="story1"></main><button id="existing">Existing focus</button>';
  const existing = document.getElementById('existing')!;
  existing.focus();
  query.mockReturnValue({ status: 'ready', data: post });
  const view = render(
    <React.StrictMode>
      <BlogPostView postId="story1" />
    </React.StrictMode>
  );
  expect(existing).toHaveFocus();
  expect(view.container.querySelector('.lm-reveal')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(post.title);
});
it('focuses the heading on in-app story navigation and again when returning', () => {
  document.body.innerHTML = '<main id="lm-journal-document" data-post-id="story1"></main>';
  query.mockReturnValue({ status: 'ready', data: post });
  const view = render(<BlogPostView postId="story1" />);
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
  query.mockReturnValue({
    status: 'ready',
    data: { ...post, _id: 'story2', title: 'Second story' },
  });
  view.rerender(<BlogPostView postId="story2" />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  query.mockReturnValue({ status: 'ready', data: post });
  view.rerender(<BlogPostView postId="story1" />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
});
it('transfers focus from a disconnected server control to the client heading', () => {
  document.body.innerHTML =
    '<main id="lm-journal-document" data-post-id="story1"><a href="/blog">Back to Blog</a></main>';
  const link = document.querySelector('a')!;
  link.focus();
  query.mockReturnValue({ status: 'ready', data: post });
  render(
    <React.StrictMode>
      <BlogPostView postId="story1" />
    </React.StrictMode>
  );
  expect(link.isConnected).toBe(false);
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
});
