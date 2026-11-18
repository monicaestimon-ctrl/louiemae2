import { publicProductImage, STOREFRONT_ORIGIN } from './productMetadata.js';
import { imageEntry, responsiveImage, responsiveAvifSource } from './responsiveImage.js';

export type PublicPageDocument = {
  id: 'shop' | 'story'; heroTitle?: string; heroSubtitle?: string; title: string; description: string; image?: string;
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
  // Match the interactive first viewport so replacing the source document does
  // not move or re-hide the headline and hero image when the module arrives.
  const heroSource = publicProductImage(page.image || '');
  const heroSizes = page.id === 'story' ? '(min-width: 432px) 384px, calc(100vw - 48px)' : '100vw';
  const heroResponsive = responsiveImage(heroSource, heroSizes);
  const heroEntry = imageEntry(heroSource);
  const heroAvif = page.id === 'story' ? responsiveAvifSource(heroSource, heroSizes) : undefined;
  const heroImg = heroSource ? `<img src="${escape(heroResponsive.src)}" ${heroResponsive.srcSet ? `srcset="${escape(heroResponsive.srcSet)}" sizes="${heroSizes}"` : ''} alt="${page.id === 'story' ? 'Our Journey' : 'Louie Mae Signature'}" loading="eager" fetchpriority="high" decoding="async" ${page.id === 'story' && heroEntry ? `width="1000" height="${Math.round(1000 * heroEntry.ratio)}"` : ''} class="${page.id === 'story' ? 'w-full h-auto object-contain rounded-2xl grayscale-[20%]' : 'w-full h-[300px] md:h-[450px] object-cover'}"/>` : '';
  const heroImage = !heroSource && page.id === 'story' ? '<div role="img" aria-label="Our Journey image unavailable" class="w-full flex items-center justify-center bg-cream text-muted-earth text-sm p-6" style="aspect-ratio: 0.6666666666666666">Image temporarily unavailable</div>' : heroAvif ? `<picture><source type="image/avif" media="(scripting: enabled)" srcset="${escape(heroAvif.srcSet)}" sizes="${escape(heroAvif.sizes)}"/>${heroImg}</picture>` : heroImg;
  const hero = page.id === 'story'
    ? `<section class="px-6 md:px-12 mb-20 md:mb-32"><div class="container mx-auto max-w-5xl"><div class="text-center mb-12 md:mb-20"><span class="text-bronze text-xs md:text-sm font-sans uppercase tracking-[0.4em] block mb-6">The Origins</span><h1 class="font-serif text-3xl md:text-6xl lg:text-7xl text-earth leading-none tracking-tight">${escape(page.heroTitle || page.title)} <span class="italic font-light">${escape(page.heroSubtitle || '')}</span></h1></div><div class="relative w-full overflow-hidden rounded-2xl mb-16 shadow-sm mx-auto max-w-sm">${heroImage}</div></div></section>`
    : `<section class="px-6 md:px-12 mb-20"><div class="container mx-auto flex flex-col items-center"><div class="text-center mb-10"><p class="text-bronze text-xs md:text-sm uppercase tracking-[0.25em] mb-3">Est. 2021</p><h1 class="font-serif text-6xl md:text-8xl text-earth leading-none">${escape(page.title)}</h1></div><div class="w-full relative overflow-hidden rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-earth/5">${heroImage}<div class="absolute inset-0 border border-white/30 rounded-[2.5rem] pointer-events-none mix-blend-overlay"></div></div></div></section>`;
  const content = `<main id="lm-page-document" data-page-id="${page.id}" tabindex="-1" class="bg-cream min-h-screen w-full overflow-hidden pt-32 ${page.id === 'story' ? 'pb-32' : 'pb-20'}">${hero}<div class="lm-page-body"><a href="/">Louie Mae</a><p>${escape(page.description)}</p>${page.sections.map(section => `<section>${section.heading ? `<h2>${escape(section.heading)}</h2>` : ''}${section.text ? `<p class="lm-page-text">${escape(section.text)}</p>` : ''}${image(section.image, section.heading || '')}</section>`).join('')}${page.links.length ? `<nav aria-label="Explore collections"><h2>Explore Collections</h2>${page.links.map(link => `<a href="${escape(link.href)}">${image(link.image, '')}<span>${escape(link.title)}</span></a>`).join('')}</nav>` : ''}<noscript><p>These links work without JavaScript. Enable JavaScript for account and shopping tools.</p></noscript></div></main>`;
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
  html = html.replace('</head>', () => `<style>#lm-page-document{position:relative;background:#f9f7f2;color:#4a3b32;min-height:100vh}#lm-page-document~#root{visibility:hidden;position:absolute;inset:0 0 auto}.lm-page-body{padding:0 max(24px,calc((100vw - 900px)/2));font:18px/1.7 Arial,sans-serif}.lm-page-body h2{font-family:Georgia,serif;line-height:1.2;overflow-wrap:anywhere}.lm-page-body img{max-width:100%;height:auto;display:block;margin:24px auto}.lm-page-body a{color:inherit;text-decoration:underline}.lm-page-body nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}.lm-page-text{white-space:pre-line}</style><script id="lm-page-structured-data" data-page-id="${page.id}" type="application/ld+json">${structured}</script></head>`);
  return html.replace('<!--product-document-->', () => content);
}
