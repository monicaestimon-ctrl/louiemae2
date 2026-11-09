import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeImage } from '../SafeImage';

const media = [{ url: 'https://example.com/large.webp', altText: 'Oak dining chair, pair', variantIds: ['chair'], renditions: [
  { url: 'https://example.com/small.webp', width: 640 },
  { url: 'https://example.com/large.webp', width: 1280 },
] }];
describe('reviewed catalog photography', () => {
  it('uses matching approved descriptions and responsive candidates, and clears them on fallback', () => {
    render(<SafeImage src={media[0].url} alt="Chair" media={media} sizes="50vw" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('alt', 'Oak dining chair, pair');
    expect(img).toHaveAttribute('srcset', 'https://example.com/small.webp 640w, https://example.com/large.webp 1280w');
    expect(img).toHaveAttribute('sizes', '50vw');
    fireEvent.error(img);
    expect(img).not.toHaveAttribute('srcset');
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', '/images/product-unavailable.svg');
  });
  it('does not apply another variant photo metadata and recovers when the source changes', () => {
    const view = render(<SafeImage src={media[0].url} alt="Chair" media={media} />);
    fireEvent.error(screen.getByRole('img'));
    view.rerender(<SafeImage src="https://example.com/other.webp" alt="Other chair" media={media} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/other.webp');
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Other chair');
    expect(screen.getByRole('img')).not.toHaveAttribute('srcset');
    view.rerender(<SafeImage src={media[0].url} alt="Chair" media={media} />);
    expect(screen.getByRole('img')).toHaveAttribute('srcset');
  });
});
