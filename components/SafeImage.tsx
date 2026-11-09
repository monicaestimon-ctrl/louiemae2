import React, { useEffect, useMemo, useState } from 'react';
import { getImageProxyUrl, isHttpImageUrl, normalizeImageUrl } from '../lib/imageUrls';
import { responsiveImage } from '../lib/responsiveImage';
import type { ProductImageMedia } from '../types';

type SafeImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null;
  fallbackSrc?: string;
  proxyFilename?: string;
  media?: ProductImageMedia[];
};

export const PRODUCT_IMAGE_FALLBACK = '/images/brand/rustic-vase.png';

export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  fallbackSrc: explicitFallback,
  proxyFilename,
  media,
  referrerPolicy = 'no-referrer',
  loading = 'lazy',
  onError,
  ...props
}) => {
  const fallbackSrc = explicitFallback ?? (media?.length ? '/images/product-unavailable.svg' : PRODUCT_IMAGE_FALLBACK);
  const normalizedSrc = useMemo(() => normalizeImageUrl(src), [src]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setAttempt(0);
  }, [normalizedSrc]);

  const displaySrc = useMemo(() => {
    if (!normalizedSrc) return fallbackSrc;
    if (attempt === 0) return normalizedSrc;
    if (attempt === 1 && isHttpImageUrl(normalizedSrc)) {
      return getImageProxyUrl(normalizedSrc, proxyFilename || props.alt || 'product-image');
    }
    return fallbackSrc;
  }, [attempt, fallbackSrc, normalizedSrc, props.alt, proxyFilename]);

  const reviewed = media?.find(m => normalizeImageUrl(m.url) === normalizedSrc);
  const candidates = reviewed?.renditions.filter(r => Number.isSafeInteger(r.width) && r.width > 0)
    .sort((a, b) => a.width - b.width);
  const responsive = attempt === 0 && candidates?.length ? {
    src: displaySrc,
    srcSet: candidates.map(r => `${r.url} ${r.width}w`).join(', '),
    sizes: props.sizes ?? '100vw',
  } : attempt === 0 ? responsiveImage(displaySrc, props.sizes) : { src: displaySrc, srcSet: undefined };

  return (
    <img
      decoding="async"
      {...props}
      {...responsive}
      alt={reviewed?.altText || props.alt}
      referrerPolicy={referrerPolicy}
      loading={loading}
      onError={(event) => {
        if (attempt >= 2) onError?.(event);
        setAttempt((current) => Math.min(current + 1, 2));
      }}
    />
  );
};

export default SafeImage;
