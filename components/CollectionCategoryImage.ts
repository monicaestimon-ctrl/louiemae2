import React, { useState } from 'react';
import { responsiveImage, responsiveAvifSource } from '../lib/responsiveImage.js';

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet'> & { source: string };

function Attempt({ source, sizes = '(min-width: 768px) 33vw, 200px', ...props }: Props) {
  const [failedAvif, setFailedAvif] = useState(false);
  const [failedImage, setFailedImage] = useState(false);
  const avif = !failedAvif ? responsiveAvifSource(source, sizes) : undefined;
  if (failedImage)
    return React.createElement('span', { className: props.className, 'aria-hidden': true });
  const img = React.createElement('img', {
    ...props,
    ...responsiveImage(source, sizes),
    alt: props.alt ?? '',
    onError: (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (avif && /\.avif(?:[?#]|$)/i.test(event.currentTarget.currentSrc)) setFailedAvif(true);
      else {
        setFailedImage(true);
        props.onError?.(event);
      }
    },
  });
  return avif
    ? React.createElement(
        'picture',
        { style: { display: 'contents' } },
        React.createElement('source', { ...avif, media: '(scripting: enabled)' }),
        img
      )
    : img;
}

/** Same markup in the source document and browser, with source-specific retry state. */
export function CollectionCategoryImage(props: Props) {
  return React.createElement(Attempt, { ...props, key: props.source });
}
