import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollectionRootHero } from '../components/CollectionRootHero.js';
import type { Category } from '../types';
import { publicProductImage, STOREFRONT_ORIGIN } from './productMetadata.js';
import { responsiveImage } from './responsiveImage.js';

export type PublicCollectionDocument = {
  rootCategories?: Category[]; id: string; title: string; subtitle: string; heroImage?: string; primaryCategoryImage?: string;
  categories: { id: string; title: string }[];
  cards: { id: string; name: string; image: string; price: number }[];
};
const escape = (value: string) => value.replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** Crawlable public content only; checkout always rechecks current authority. */
export function collectionDocument(template: string, collection: PublicCollectionDocument) {
  if (!template.includes('<!--product-document-->')) throw new Error('Document marker missing');
  const canonical = `${STOREFRONT_ORIGIN}/collection/${encodeURIComponent(collection.id)}`;
  const title = `${collection.title} | Louie Mae`;
  const description = collection.subtitle.slice(0, 160);
  const socialSource = publicProductImage(collection.heroImage || (collection.rootCategories && collection.id !== 'kids' ? collection.primaryCategoryImage : collection.cards[0]?.image) || '');
  const socialImage = socialSource ? new URL(socialSource, STOREFRONT_ORIGIN).href : '';
  const primaryImage = responsiveImage(publicProductImage(collection.primaryCategoryImage || ''), '(min-width: 768px) 33vw, 200px');
  const preload = primaryImage.src ? `<link rel="preload" as="image" href="${escape(primaryImage.src)}" ${primaryImage.srcSet ? `imagesrcset="${escape(primaryImage.srcSet)}" imagesizes="(min-width: 768px) 33vw, 200px"` : ''} fetchpriority="high"/>` : '';
  const cards = collection.cards.map((card, index) => {
    const image = responsiveImage(publicProductImage(card.image), '(min-width: 1024px) 25vw, 50vw');
    const url = `/products/${encodeURIComponent(card.id)}`;
    return `<a class="lm-collection-card" href="${url}">${image.src ? `<img src="${escape(image.src)}" ${image.srcSet ? `srcset="${escape(image.srcSet)}" sizes="(min-width: 1024px) 25vw, 50vw"` : ''} alt="${escape(card.name)}" loading="${index === 0 && !collection.rootCategories ? 'eager' : 'lazy'}" ${index === 0 && !collection.rootCategories ? 'fetchpriority="high"' : 'fetchpriority="low"'} decoding="async" width="480" height="480"/>` : ''}<h2>${escape(card.name)}</h2><p>${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(card.price)}</p></a>`;
  }).join('');
  const hero = collection.rootCategories ? renderToStaticMarkup(React.createElement(CollectionRootHero, {collection:collection.id,title:collection.title,subtitle:collection.subtitle,categories:collection.rootCategories})) : null;
  const content = `<main id="lm-collection-document" data-collection-id="${escape(collection.id)}" tabindex="-1" ${hero ? 'data-root-hero="true" class="bg-cream min-h-screen pt-20"' : 'class="lm-collection-basic"'}>${hero ? `<section class="relative w-full min-h-screen flex flex-col"><div class="absolute inset-0 bg-cream z-0"></div>${hero}</section>` : ''}<div class="lm-collection-body"><a href="/">Louie Mae</a>${hero ? '' : `<h1>${escape(collection.title)}</h1><p>${escape(collection.subtitle)}</p>`}<nav aria-label="Collection categories">${collection.categories.map(category => `<a href="/collection/${encodeURIComponent(collection.id)}?cat=${encodeURIComponent(category.id)}&amp;view=products">${escape(category.title)}</a>`).join('')}</nav>${cards ? `<div class="lm-collection-grid">${cards}</div>` : ''}<p role="status">Loading current collection options…</p><noscript><p>Enable JavaScript for the full catalog, filters and purchasing. <a href="/#support/contact">Contact us for assistance</a>.</p></noscript></div></main>`;
  let html = template.replace(/<!--home-document-start-->[\s\S]*?<!--home-document-end-->/, '')
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escape(title)}</title>`);
  const tags = { description, 'og:title': title, 'twitter:title': title,
    'og:description': description, 'twitter:description': description, 'og:url': canonical, 'og:type': 'website',
    'og:image': socialImage, 'twitter:image': socialImage };
  for (const [name, value] of Object.entries(tags)) html = html.replace(
    new RegExp(`<meta (?:name|property)="${name}"[^>]*>`, 'g'),
    () => `<meta ${name.startsWith('og:') ? 'property' : 'name'}="${name}" content="${escape(value)}"/>`);
  html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${canonical}"/>`);
  html = html.replace(/<meta property="og:image:(?:width|height)"[^>]*>/g, '');
  html = html.replace('</head>', () => `${preload}</head>`);
  const structured = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: collection.title, description, url: canonical,
    mainEntity: { '@type': 'ItemList', itemListElement: collection.cards.map((card, index) => ({
      '@type': 'ListItem', position: index + 1, url: `${STOREFRONT_ORIGIN}/products/${encodeURIComponent(card.id)}`,
    })) } }).replace(/</g, '\\u003c');
  html = html.replace('</head>', () => `<style>#lm-collection-document{position:relative;min-height:100vh;background:#f9f7f2;color:#4a3b32}.lm-collection-body{padding:40px max(24px,calc((100vw - 1200px)/2));font-family:Arial,sans-serif}#lm-collection-document~#root{visibility:hidden;position:absolute;inset:0 0 auto}.lm-collection-body h1{font-family:Georgia,serif;font-size:clamp(36px,6vw,64px);margin:32px 0 16px}.lm-collection-body a{color:inherit;text-decoration:underline}.lm-collection-body nav{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}.lm-collection-body nav a{padding:12px;border:1px solid #d6cfc7}.lm-collection-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.lm-collection-card{min-width:0}.lm-collection-card img{width:100%;height:auto;aspect-ratio:1;object-fit:contain;background:white}.lm-collection-card h2{font:22px Georgia,serif;overflow-wrap:anywhere;margin-top:12px}@media(min-width:1024px){.lm-collection-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}</style><script id="lm-collection-structured-data" data-collection-id="${escape(collection.id)}" type="application/ld+json">${structured}</script></head>`);
  return html.replace('<!--product-document-->', () => content);
}
