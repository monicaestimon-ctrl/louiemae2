import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  JournalIndexLead,
  JournalArchive,
  JournalEmptyContent,
  JournalArticleHero,
  JournalArticleHeading,
} from '../components/JournalLead.js';
import { escapeJournalText as escape, journalHtml } from './journalContent.js';
import { journalUrl } from './journalUrl.js';
import { publicProductImage, STOREFRONT_ORIGIN } from './productMetadata.js';

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
  const canonical = `${STOREFRONT_ORIGIN}${path}`;
  const title = article?.title || 'Simply Mae';
  const description = (
    article?.excerpt ||
    'On faith, family, design, and finding beauty in the everyday rhythms of life.'
  ).slice(0, 160);
  const leadPost = (post: JournalPost) => ({
    ...post,
    id: post._id,
    image: publicProductImage(post.image),
  });
  const readingTime = Math.max(
    1,
    Math.ceil(
      (article?.content || '')
        .replace(/<[^>]*>/g, '')
        .split(/\s+/)
        .filter(Boolean).length / 200
    )
  );
  const lead = article
    ? renderToStaticMarkup(React.createElement(JournalArticleHero, { post: leadPost(article) })) +
      '<div class="max-w-3xl mx-auto px-6 md:px-8 pt-10"><div class="flex items-center justify-between mb-12"><a href="/blog" class="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-earth"><span aria-hidden="true">←</span>Back to Blog</a><span class="flex items-center gap-2 px-4 py-2 rounded-full bg-earth/5 text-muted-earth"><span aria-hidden="true" class="w-4 h-4"></span><span class="text-[10px] uppercase tracking-[0.15em] font-medium">Share</span></span></div></div>' +
      '<article class="max-w-3xl mx-auto px-6 md:px-8">' +
      renderToStaticMarkup(
        React.createElement(JournalArticleHeading, { post: leadPost(article), readingTime })
      ) +
      `<div class="prose-blog font-serif text-lg text-earth leading-relaxed mb-12">${journalHtml(article.content || '')}</div></article>`
    : posts.length
      ? renderToStaticMarkup(
          React.createElement(JournalIndexLead, { featuredPost: leadPost(posts[0]) })
        ) +
        renderToStaticMarkup(
          React.createElement(JournalArchive, { recentPosts: posts.slice(1).map(leadPost) })
        )
      : renderToStaticMarkup(React.createElement(JournalEmptyContent));
  const empty = !article && !posts.length;
  const mainClass = empty
    ? 'min-h-screen bg-cream flex items-center justify-center'
    : `bg-cream min-h-screen ${article ? '' : 'pt-32 '}pb-20 w-full overflow-hidden`;
  const content = `<main id="lm-journal-document" data-post-id="${escape(id)}" tabindex="-1" class="${mainClass}">${lead}${empty ? '' : '<a href="/shop" class="block px-6 underline">Explore the shop</a>'}</main>`;
  let html = template
    .replace(/<!--home-document-start-->[\s\S]*?<!--home-document-end-->/, '')
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escape(title)} | Louie Mae</title>`);
  const source = publicProductImage(article?.image || posts[0]?.image || '');
  const social = source ? new URL(source, STOREFRONT_ORIGIN).href : '';
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
      `<style>#lm-journal-document{position:absolute;inset:0 0 auto;overflow-wrap:anywhere}#lm-journal-document~#root{visibility:hidden}#lm-journal-document pre,#lm-journal-document table{display:block;max-width:100%;overflow:auto}</style><script id="lm-journal-structured-data" data-post-id="${escape(id)}" type="application/ld+json">${structured}</script></head>`
  );
  return html.replace('<!--product-document-->', () => content);
}
