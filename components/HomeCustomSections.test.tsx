import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HomeCustomSections } from './HomeCustomSections';
const state = vi.hoisted(() => ({ loaded: vi.fn(), fail: false }));
vi.mock('./DynamicPage', () => {
  state.loaded();
  return {
    DynamicSectionRenderer: ({ section }: { section: { heading: string } }) => {
      if (state.fail) throw Error('Private rendering detail');
      return <h2>{section.heading}</h2>;
    },
  };
});
afterEach(() => {
  cleanup();
  state.fail = false;
  vi.restoreAllMocks();
});
it('does not request the renderer when no custom content exists', () => {
  const view = render(<HomeCustomSections />);
  expect(view.container).toBeEmptyDOMElement();
  expect(state.loaded).not.toHaveBeenCalled();
});
it('loads configured content and preserves its headings', async () => {
  render(
    <HomeCustomSections
      sections={[{ id: 'custom', type: 'text', heading: 'Custom story', content: 'Story' }]}
    />
  );
  expect(await screen.findByRole('heading', { name: 'Custom story' })).toBeVisible();
  expect(state.loaded).toHaveBeenCalledOnce();
});
it('keeps the rest of the homepage available and offers recovery after failure', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.fail = true;
  render(
    <>
      <p>Other homepage content</p>
      <HomeCustomSections sections={[{ id: 'custom', type: 'text', heading: 'Custom story' }]} />
    </>
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Additional homepage content could not be loaded'
  );
  expect(screen.getByText('Other homepage content')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeVisible();
  expect(screen.queryByText('Private rendering detail')).toBeNull();
});
