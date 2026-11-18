import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SafeImage, PRODUCT_IMAGE_FALLBACK } from '../SafeImage';
vi.mock('../../lib/responsiveImage', () => ({
  responsiveImage: (src: string, sizes = '100vw') =>
    src === '/known'
      ? { src: '/known-640.webp', srcSet: '/known-320.webp 320w, /known-640.webp 640w', sizes }
      : { src },
  responsiveAvifSource: (src: string, sizes: string) =>
    src === '/known'
      ? { type: 'image/avif', srcSet: '/known-320.avif 320w, /known-640.avif 640w', sizes }
      : undefined,
}));
afterEach(cleanup);
function error(currentSrc: string) {
  const img = screen.getByRole('img');
  Object.defineProperty(img, 'currentSrc', { configurable: true, value: currentSrc });
  fireEvent.error(img);
}
it('uses a product-unavailable placeholder rather than a different product photograph', () => {
  render(<SafeImage alt="Selected product" />);
  expect(screen.getByRole('img')).toHaveAttribute('src', '/images/product-unavailable.svg');
  expect(PRODUCT_IMAGE_FALLBACK).toBe('/images/product-unavailable.svg');
});
it('preserves explicitly requested fallback images', () => {
  render(<SafeImage alt="Selected product" fallbackSrc="/explicit.svg" />);
  expect(screen.getByRole('img')).toHaveAttribute('src', '/explicit.svg');
});
it('keeps prepared AVIF sizes aligned with the WebP image', () => {
  render(<SafeImage src="/known" alt="Selected product" sizes="364px" />);
  expect(document.querySelector('source')).toHaveAttribute('sizes', '364px');
  expect(screen.getByRole('img')).toHaveAttribute('sizes', '364px');
  expect(document.querySelector('picture')).toHaveStyle({ display: 'contents' });
});
it('falls from a failed AVIF to WebP without skipping to the terminal placeholder', () => {
  render(<SafeImage src="/known" alt="Selected product" />);
  error('https://fixture.invalid/known-640.avif');
  expect(document.querySelector('source')).toBeNull();
  expect(screen.getByRole('img')).toHaveAttribute('src', '/known-640.webp');
  error('https://fixture.invalid/known-640.webp');
  expect(screen.getByRole('img')).toHaveAttribute('src', PRODUCT_IMAGE_FALLBACK);
});
it('does not mistake unsupported-AVIF WebP failure for an AVIF failure', () => {
  render(<SafeImage src="/known" alt="Selected product" />);
  error('https://fixture.invalid/known-640.webp');
  expect(document.querySelector('source')).toBeNull();
  expect(screen.getByRole('img')).toHaveAttribute('src', PRODUCT_IMAGE_FALLBACK);
});
it('resets both format and retry state when switching sources and returning', () => {
  const view = render(<SafeImage src="/known" alt="Selected product" />);
  error('https://fixture.invalid/known-640.avif');
  error('https://fixture.invalid/known-640.webp');
  view.rerender(<SafeImage src="/different.webp" alt="Selected product" />);
  expect(screen.getByRole('img')).toHaveAttribute('src', '/different.webp');
  view.rerender(<SafeImage src="/known" alt="Selected product" />);
  expect(document.querySelector('source')).not.toBeNull();
  expect(screen.getByRole('img')).toHaveAttribute('src', '/known-640.webp');
});
it('keeps unknown remote uploads unchanged and preserves bounded proxy recovery', () => {
  const onError = vi.fn();
  render(
    <SafeImage src="https://example.com/photo.png" alt="Selected product" onError={onError} />
  );
  expect(document.querySelector('source')).toBeNull();
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/photo.png');
  error('https://example.com/photo.png');
  expect(onError).not.toHaveBeenCalled();
  expect(screen.getByRole('img').getAttribute('src')).toContain('/api/download-image?');
  error('https://fixture.invalid/api/download-image');
  expect(onError).not.toHaveBeenCalled();
  expect(screen.getByRole('img')).toHaveAttribute('src', PRODUCT_IMAGE_FALLBACK);
  error('https://fixture.invalid/images/product-unavailable.svg');
  expect(onError).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('img')).toHaveAttribute('src', PRODUCT_IMAGE_FALLBACK);
});
it('respects explicitly reviewed media renditions ahead of the prepared format manifest', () => {
  render(
    <SafeImage
      src="/known"
      alt="Generic"
      media={[
        {
          url: '/known',
          altText: 'Reviewed product view',
          variantIds: ['v'],
          renditions: [{ url: '/approved-640.webp', width: 640 }],
        },
      ]}
    />
  );
  expect(document.querySelector('source')).toBeNull();
  expect(screen.getByRole('img', { name: 'Reviewed product view' })).toHaveAttribute(
    'srcset',
    '/approved-640.webp 640w'
  );
});
