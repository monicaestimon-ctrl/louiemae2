import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ image: '/images/brand/fam2.png' }));
vi.mock('../../contexts/BlogContext', () => ({
  useSite: () => ({
    siteContent: {
      story: {
        hero: { title: 'Our', subtitle: 'Story', image: state.image },
        prologue: { quote: 'A home', subtext: 'Fixture' },
        chapters: { oneText: 'First', twoText: 'Second', threeText: 'Third', fourText: 'Fourth' },
        sections: [],
      },
    },
  }),
}));
vi.mock('../DynamicPage', () => ({ DynamicSectionRenderer: () => null }));
import { StoryPage } from '../StoryPage';
beforeEach(() => {
  state.image = '/images/brand/fam2.png';
});
describe('Story image recovery', () => {
  it('falls back from AVIF to WebP, then preserves image space; a new source is not held', () => {
    const view = render(<StoryPage />);
    expect(view.container.querySelector('source[type="image/avif"]')).not.toBeNull();
    Object.defineProperty(screen.getByAltText('Our Journey'), 'currentSrc', {
      configurable: true,
      value: 'https://example.test/hero.avif',
    });
    fireEvent.error(screen.getByAltText('Our Journey'));
    expect(view.container.querySelector('source[type="image/avif"]')).toBeNull();
    expect(screen.getByAltText('Our Journey').getAttribute('srcset')).toContain('.webp');
    Object.defineProperty(screen.getByAltText('Our Journey'), 'currentSrc', {
      configurable: true,
      value: 'https://example.test/hero.webp',
    });
    fireEvent.error(screen.getByAltText('Our Journey'));
    const placeholder = screen.getByRole('img', { name: 'Our Journey image unavailable' });
    expect(Number(placeholder.style.aspectRatio)).toBeCloseTo(2 / 3);
    state.image = '/different-source.jpg';
    view.rerender(<StoryPage />);
    expect(screen.queryByRole('img', { name: 'Our Journey image unavailable' })).toBeNull();
    expect(screen.getByAltText('Our Journey').getAttribute('src')).toBe('/different-source.jpg');
    state.image = '/images/brand/fam2.png';
    view.rerender(<StoryPage />);
    expect(view.container.querySelector('source[type="image/avif"]')).not.toBeNull();
    expect(screen.getByAltText('Our Journey')).toBeTruthy();
  });
  it('shows the placeholder on the first WebP error when AVIF is unsupported', () => {
    render(<StoryPage />);
    Object.defineProperty(screen.getByAltText('Our Journey'), 'currentSrc', {
      value: 'https://example.test/hero.webp',
    });
    fireEvent.error(screen.getByAltText('Our Journey'));
    expect(screen.getByRole('img', { name: 'Our Journey image unavailable' })).toBeTruthy();
  });
  it('shows the accessible placeholder for an empty source without issuing an empty image request', () => {
    state.image = '';
    const view = render(<StoryPage />);
    expect(screen.getByRole('img', { name: 'Our Journey image unavailable' })).toBeTruthy();
    expect(view.container.querySelector('picture img')).toBeNull();
  });
});
