import { escapeJournalText as escape, journalHtml } from './journalContent.js';
import { journalUrl } from './journalUrl.js';
import { publicProductImage } from './productMetadata.js';
import { responsiveImage } from './responsiveImage.js';

export type JournalPost = {
  _id: string;
  title: string;
  excerpt: string;
  content?: string;
  image: string;
  category: string;
  date: string;
};
export function journalDocument(template: string, posts: JournalPost[], article?: JournalPost) {
  if (!template.includes('<!--product-document-->')) throw new Error('Document marker missing');
  const id = article?._id || 'index';
  const path = article ? journalUrl(article._id) : '/blog';
  const canonical = `https://louiemae.com${path}`;
  const title = article?.title || 'Simply Mae';
  const description = (
    article?.excerpt ||
    'On faith, family, design, and finding beauty in the everyday rhythms of life.'
  ).slice(0, 160);
  const image = (post: JournalPost, eager = false, decorative = false) => {
    const source = responsiveImage(
      publicProductImage(post.image),
      '(min-width: 1024px) 800px, 100vw'
    );
    return source.src
      ? `<img src="${escape(source.src)}" ${source.srcSet ? `srcset="${escape(source.srcSet)}" sizes="(min-width: 1024px) 800px, 100vw"` : ''} alt="${decorative ? '' : escape(post.title)}" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''} decoding="async"/>`
      : '';
  };
  const content = `<main id="lm-journal-document" data-post-id="${escape(id)}" tabindex="-1"><a href="/blog">Simply Mae journal</a><h1>${escape(title)}</h1><p>${escape(description)}</p>${article ? `<article><p>${escape(article.category)} · ${escape(article.date)}</p>${image(article, true)}<div class="prose-blog">${journalHtml(article.content || '')}</div></article>` : posts.length ? `<div>${posts.map((post, index) => `<article><a href="${journalUrl(post._id)}">${image(post, index === 0, true)}<h2>${escape(post.title)}</h2></a><p>${escape(post.excerpt)}</p><p>${escape(post.date)}</p></article>`).join('')}</div>` : '<p>New stories are coming soon.</p>'}<a href="/shop">Explore the shop</a></main>`;
  let html = template
    .replace(/<!--home-document-start-->[\s\S]*?<!--home-document-end-->/, '')
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escape(title)} | Louie Mae</title>`);
  const source = publicProductImage(article?.image || posts[0]?.image || '');
  const social = source ? new URL(source, 'https://louiemae.com').href : '';
  for (const [key, value] of Object.entries({
    description,
    'og:title': `${title} | Louie Mae`,
    'twitter:title': `${title} | Louie Mae`,
    'og:description': description,
    'twitter:description': description,
    'og:url': canonical,
    'og:type': article ? 'article' : 'website',
    'og:image': social,
    'twitter:image': social,
  }))
    html = html.replace(
      new RegExp(`<meta (?:name|property)="${key}"[^>]*>`, 'g'),
      () =>
        `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escape(value)}"/>`
    );
  html = html
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${canonical}"/>`)
    .replace(/<meta property="og:image:(?:width|height)"[^>]*>/g, '');
  const structured = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': article ? 'BlogPosting' : 'Blog',
    name: title,
    ...(article ? { headline: title } : {}),
    description,
    url: canonical,
    ...(social ? { image: social } : {}),
  }).replace(/</g, '\\u003c');
  html = html.replace(
    '</head>',
    () =>
      `<style>#lm-journal-document{position:absolute;inset:0 0 auto;min-height:100vh;background:#f9f7f2;color:#4a3b32;padding:40px max(24px,calc((100vw - 800px)/2));font:18px/1.7 Arial,sans-serif;overflow-wrap:anywhere}#lm-journal-document~#root{visibility:hidden}#lm-journal-document h1,#lm-journal-document h2{font-family:Georgia,serif;line-height:1.2}#lm-journal-document h1{font-size:clamp(32px,6vw,64px)}#lm-journal-document img{max-width:100%;height:auto;display:block;margin:24px auto}#lm-journal-document a{color:inherit;text-decoration:underline}#lm-journal-document article{margin:40px 0}#lm-journal-document pre,#lm-journal-document table{display:block;max-width:100%;overflow:auto}</style><script id="lm-journal-structured-data" data-post-id="${escape(id)}" type="application/ld+json">${structured}</script></head>`
  );
  return html.replace('<!--product-document-->', () => content);
}
