import { publicProductImage, STOREFRONT_ORIGIN } from './productMetadata.js';
import { responsiveImage } from './responsiveImage.js';

export type PublicPageDocument = {
  id: 'shop' | 'story'; title: string; description: string; image?: string;
  sections: { heading?: string; text?: string; image?: string }[];
  links: { title: string; href: string; image?: string }[];
};
const escape = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Render source-owned public text; no raw rich HTML or private account data is accepted. */
export function pageDocument(template: string, page: PublicPageDocument) {
  if (!template.includes('<!--product-document-->')) throw new Error('Document marker missing');
  const canonical = `${STOREFRONT_ORIGIN}/${page.id}`;
  const title = `${page.id === 'story' ? 'Our Story' : 'Shop'} | Louie Mae`;
  const image = (source: string | undefined, alt: string, eager = false) => {
    const responsive = responsiveImage(publicProductImage(source || ''), '(min-width: 1024px) 800px, 100vw');
    return responsive.src ? `<img src="${escape(responsive.src)}" ${responsive.srcSet ? `srcset="${escape(responsive.srcSet)}" sizes="(min-width: 1024px) 800px, 100vw"` : ''} alt="${escape(alt)}" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''} decoding="async"/>` : '';
  };
  const content = `<main id="lm-page-document" data-page-id="${page.id}" tabindex="-1"><a href="/">Louie Mae</a><h1>${escape(page.title)}</h1><p>${escape(page.description)}</p>${image(page.image, page.title, true)}${page.sections.map(section => `<section>${section.heading ? `<h2>${escape(section.heading)}</h2>` : ''}${section.text ? `<p class="lm-page-text">${escape(section.text)}</p>` : ''}${image(section.image, section.heading || '')}</section>`).join('')}${page.links.length ? `<nav aria-label="Explore collections">${page.links.map(link => `<a href="${escape(link.href)}">${image(link.image, '')}<span>${escape(link.title)}</span></a>`).join('')}</nav>` : ''}<noscript><p>These links work without JavaScript. Enable JavaScript for account and shopping tools.</p></noscript></main>`;
  let html = template.replace(/<!--home-document-start-->[\s\S]*?<!--home-document-end-->/, '')
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escape(title)}</title>`);
  const source = publicProductImage(page.image || '');
  const social = source ? new URL(source, STOREFRONT_ORIGIN).href : '';
  for (const [key, value] of Object.entries({ description: page.description, 'og:title': title, 'twitter:title': title,
    'og:description': page.description, 'twitter:description': page.description, 'og:url': canonical,
    'og:type': 'website', 'og:image': social, 'twitter:image': social })) {
    html = html.replace(new RegExp(`<meta (?:name|property)="${key}"[^>]*>`, 'g'), () => `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escape(value)}"/>`);
  }
  html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${canonical}"/>`)
    .replace(/<meta property="og:image:(?:width|height)"[^>]*>/g, '');
  const structured = JSON.stringify({ '@context': 'https://schema.org', '@type': page.id === 'story' ? 'AboutPage' : 'CollectionPage', name: page.title, description: page.description, url: canonical }).replace(/</g, '\\u003c');
  html = html.replace('</head>', () => `<style>#lm-page-document{position:absolute;inset:0 0 auto;background:#f9f7f2;color:#4a3b32;min-height:100vh;padding:40px max(24px,calc((100vw - 900px)/2));font:18px/1.7 Arial,sans-serif}#lm-page-document~#root{visibility:hidden}#lm-page-document h1,#lm-page-document h2{font-family:Georgia,serif;line-height:1.2;overflow-wrap:anywhere}#lm-page-document h1{font-size:clamp(32px,6vw,64px)}#lm-page-document img{max-width:100%;height:auto;display:block;margin:24px auto}#lm-page-document a{color:inherit;text-decoration:underline}#lm-page-document nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}.lm-page-text{white-space:pre-line}</style><script id="lm-page-structured-data" data-page-id="${page.id}" type="application/ld+json">${structured}</script></head>`);
  return html.replace('<!--product-document-->', () => content);
}
