import { useEffect, useLayoutEffect } from 'react';
import type { JournalPost } from '../lib/serverJournalDocument';
import { journalUrl } from '../lib/journalUrl';
import { publicProductImage, STOREFRONT_ORIGIN } from '../lib/productMetadata';

export function useJournalMetadata(
  id: string,
  loading: boolean,
  failed: boolean,
  post?: JournalPost | null,
  indexImage?: string
) {
  useLayoutEffect(() => {
    const initial = document.getElementById('lm-journal-document');
    if (!loading || initial?.dataset.postId !== id) initial?.remove();
  }, [id, loading]);
  useEffect(() => {
    if (loading) return;
    const title =
      post?.title ||
      (id === 'index'
        ? 'Simply Mae'
        : failed
          ? 'Story temporarily unavailable'
          : 'Story not found');
    const description = (
      post?.excerpt ||
      'On faith, family, design, and finding beauty in the everyday rhythms of life.'
    ).slice(0, 160);
    const canonical = `${STOREFRONT_ORIGIN}${id === 'index' ? '/blog' : journalUrl(id)}`;
    document.title = `${title} | Louie Mae`;
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);
    const image = publicProductImage(post?.image || indexImage || '');
    for (const [name, value] of Object.entries({
      description,
      'og:title': document.title,
      'twitter:title': document.title,
      'og:description': description,
      'twitter:description': description,
      'og:url': canonical,
      'og:type': post ? 'article' : 'website',
      'og:image': image ? new URL(image, STOREFRONT_ORIGIN).href : '',
      'twitter:image': image ? new URL(image, STOREFRONT_ORIGIN).href : '',
    }))
      document
        .querySelector(`meta[name="${name}"],meta[property="${name}"]`)
        ?.setAttribute('content', value);
    document.getElementById('lm-journal-structured-data')?.remove();
    if (!failed && (post || id === 'index')) {
      const script = document.createElement('script');
      script.id = 'lm-journal-structured-data';
      script.dataset.postId = id;
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': post ? 'BlogPosting' : 'Blog',
        name: title,
        ...(post ? { headline: title } : {}),
        description,
        url: canonical,
      });
      document.head.append(script);
    }
    if (failed || (id !== 'index' && !post)) {
      const robots = document.createElement('meta');
      robots.name = 'robots';
      robots.content = 'noindex';
      document.head.append(robots);
      return () => robots.remove();
    }
  }, [id, loading, failed, post, indexImage]);
}
