import React, { useEffect, useMemo, useState } from 'react';
import { getImageProxyUrl, isHttpImageUrl, normalizeImageUrl } from '../lib/imageUrls';

type SafeImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null;
  fallbackSrc?: string;
  proxyFilename?: string;
};

export const PRODUCT_IMAGE_FALLBACK = '/images/brand/rustic-vase.png';

export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  fallbackSrc = PRODUCT_IMAGE_FALLBACK,
  proxyFilename,
  referrerPolicy = 'no-referrer',
  loading = 'lazy',
  onError,
  ...props
}) => {
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

  return (
    <img
      {...props}
      src={displaySrc}
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
