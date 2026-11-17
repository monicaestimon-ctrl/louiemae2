import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { publicProductImage } from './productMetadata.js';

export const escapeJournalText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  );
const tags = new Set([
  'p',
  'div',
  'span',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'br',
  'hr',
  'pre',
  'code',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
]);
const discard = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'template',
  'svg',
  'math',
  'link',
  'meta',
  'base',
]);
function fragmentId(value: string) {
  if (/^lm-journal-fragment-[a-zA-Z][\w-]{0,80}$/.test(value)) return value;
  return /^[a-zA-Z][\w-]{0,80}$/.test(value) ? `lm-journal-fragment-${value}` : '';
}
function link(value: string) {
  if (!value) return '';
  if (
    value !== value.trim() ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return '';
  if (value.startsWith('#')) {
    const id = fragmentId(value.slice(1));
    return id ? `#${id}` : '';
  }
  try {
    const url = new URL(value, 'https://louiemae.com');
    return ['https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

/** Rebuild public editorial markup in the backend and initial-document renderer. */
export function journalHtml(content: string) {
  if (content.length > 1_000_000) throw new Error('Article exceeds the supported content size');
  const render = (node: DefaultTreeAdapterTypes.ChildNode, depth = 0): string => {
    if (depth > 100) throw new Error('Article exceeds the supported nesting depth');
    if (node.nodeName === '#text')
      return escapeJournalText((node as DefaultTreeAdapterTypes.TextNode).value);
    if (
      !('tagName' in node) ||
      node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      discard.has(node.tagName)
    )
      return '';
    const tag = node.tagName === 'h1' ? 'h2' : node.tagName;
    const children = node.childNodes.map((child) => render(child, depth + 1)).join('');
    if (!tags.has(tag)) return children;
    const attributes = new Map(node.attrs.map((attr) => [attr.name, attr.value]));
    let attrs = '';
    const id = fragmentId(attributes.get('id') || '');
    if (id) attrs += ` id="${id}"`;
    if (tag === 'a') {
      const href = link(attributes.get('href') || '');
      if (!href) return children;
      attrs += ` href="${escapeJournalText(href)}" rel="noopener noreferrer"`;
    }
    if (tag === 'img') {
      const src = publicProductImage(attributes.get('src') || '');
      if (!src) return '';
      attrs += ` src="${escapeJournalText(src)}" alt="${escapeJournalText(attributes.get('alt') || '')}" loading="lazy" decoding="async"`;
    }
    if (tag === 'th') attrs += ` scope="${attributes.get('scope') === 'row' ? 'row' : 'col'}"`;
    if (['td', 'th'].includes(tag))
      for (const key of ['colspan', 'rowspan']) {
        const value = attributes.get(key);
        if (value && /^[1-9]\d?$/.test(value)) attrs += ` ${key}="${value}"`;
      }
    return `<${tag}${attrs}>${['img', 'br', 'hr'].includes(tag) ? '' : `${children}</${tag}>`}`;
  };
  return parseFragment(content)
    .childNodes.map((node) => render(node))
    .join('');
}
