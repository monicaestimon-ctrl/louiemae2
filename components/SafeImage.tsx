import React, { useMemo, useState } from 'react';
import { getImageProxyUrl, isHttpImageUrl, normalizeImageUrl } from '../lib/imageUrls';
import { responsiveImage, responsiveAvifSource } from '../lib/responsiveImage';
import type { ProductImageMedia } from '../types';

type SafeImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null;
  fallbackSrc?: string;
  proxyFilename?: string;
  media?: ProductImageMedia[];
};

export const PRODUCT_IMAGE_FALLBACK = '/images/product-unavailable.svg';

const ImageAttempt: React.FC<SafeImageProps> = ({
  src,
  fallbackSrc: explicitFallback,
  proxyFilename,
  media,
  referrerPolicy = 'no-referrer',
  loading = 'lazy',
  onError,
  ...props
}) => {
  const fallbackSrc =
    explicitFallback ??
    (media?.length ? '/images/product-unavailable.svg' : PRODUCT_IMAGE_FALLBACK);
  const normalizedSrc = useMemo(() => normalizeImageUrl(src), [src]);
  const [attempt, setAttempt] = useState(0);

  const [failedAvif, setFailedAvif] = useState(false);

  const displaySrc = useMemo(() => {
    if (!normalizedSrc) return fallbackSrc;
    if (attempt === 0) return normalizedSrc;
    if (attempt === 1 && isHttpImageUrl(normalizedSrc)) {
      return getImageProxyUrl(normalizedSrc, proxyFilename || props.alt || 'product-image');
    }
    return fallbackSrc;
  }, [attempt, fallbackSrc, normalizedSrc, props.alt, proxyFilename]);

  const reviewed = media?.find((m) => normalizeImageUrl(m.url) === normalizedSrc);
  const candidates = reviewed?.renditions
    .filter((r) => Number.isSafeInteger(r.width) && r.width > 0)
    .sort((a, b) => a.width - b.width);
  const responsive =
    attempt === 0 && candidates?.length
      ? {
          src: displaySrc,
          srcSet: candidates.map((r) => `${r.url} ${r.width}w`).join(', '),
          sizes: props.sizes ?? '100vw',
        }
      : attempt === 0
        ? responsiveImage(displaySrc, props.sizes)
        : { src: displaySrc, srcSet: undefined };

  const avif =
    attempt === 0 && !failedAvif && !candidates?.length
      ? responsiveAvifSource(normalizedSrc, props.sizes ?? '100vw')
      : undefined;
  const image = (
    <img
      decoding="async"
      {...props}
      {...responsive}
      alt={reviewed?.altText || props.alt}
      referrerPolicy={referrerPolicy}
      loading={loading}
      onError={(event) => {
        if (avif && /\.avif(?:[?#]|$)/i.test(event.currentTarget.currentSrc)) {
          setFailedAvif(true);
          return;
        }
        if (attempt >= 2) onError?.(event);
        setAttempt((current) => Math.min(current + 1, 2));
      }}
    />
  );
  return avif ? (
    <picture style={{ display: 'contents' }}>
      <source {...avif} />
      {image}
    </picture>
  ) : (
    image
  );
};

/** Source changes receive fresh retry state before paint, including a return to an earlier image. */
export const SafeImage: React.FC<SafeImageProps> = (props) => (
  <ImageAttempt key={normalizeImageUrl(props.src) || ''} {...props} />
);

export default SafeImage;
