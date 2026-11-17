import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { parsePublicInitialData, publicSiteData, PUBLIC_INITIAL_ID } from './publicInitialData';
import { withPublicInitialData } from './serverPublicInitialData';
const site = {
  navLinks: [],
  collections: [],
  home: { title: '</script><script>bad()</script>' },
  story: {},
  privateCost: 12345,
};
function encoded(path = '/story', at = 1000) {
  const html = withPublicInitialData(
    '<html><head></head><body></body></html>',
    path,
    { site: publicSiteData(site) },
    at
  );
  const doc = new globalThis.DOMParser().parseFromString(html, 'text/html');
  return { html, doc, text: doc.getElementById(PUBLIC_INITIAL_ID)!.textContent! };
}
it('escapes embedded script terminators, excludes unrelated fields, and binds source revision', () => {
  const { html, doc, text } = encoded();
  expect(doc.scripts).toHaveLength(1);
  expect(html).not.toContain('privateCost');
  expect(html).not.toContain('12345');
  expect(parsePublicInitialData(text, '/story', 1000)?.site?.home.title).toBe(site.home.title);
  const envelope = JSON.parse(text);
  expect(envelope.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(encoded().text).toBe(text);
});
it('rejects wrong path, expired, future, malformed and oversized input', () => {
  const { text } = encoded();
  expect(parsePublicInitialData(text, '/shop', 1000)).toBeUndefined();
  expect(parsePublicInitialData(text, '/story', 31_001)).toBeUndefined();
  expect(parsePublicInitialData(encoded('/story', 7000).text, '/story', 1000)).toBeUndefined();
  expect(parsePublicInitialData('{', '/story')).toBeUndefined();
  expect(parsePublicInitialData('x'.repeat(300001), '/story')).toBeUndefined();
  expect(
    withPublicInitialData('<head></head>', '/story', {
      site: { ...publicSiteData(site)!, home: { text: 'x'.repeat(300001) } },
    })
  ).toBe('<head></head>');
});
it('does not read private or commerce-shaped payloads or wrong article identity', () => {
  const base = JSON.parse(encoded().text);
  base.path = '/blog/article1';
  base.data = {
    account: { token: 'secret' },
    article: {
      _id: 'article2',
      title: 'Wrong',
      status: 'published',
      excerpt: '',
      image: '',
      category: '',
      date: '',
      contentHtml: '',
    },
  };
  expect(parsePublicInitialData(JSON.stringify(base), base.path, 1000)).toEqual({});
});


it('omits a payload that exceeds the compressed public-data budget', () => {
  const data = { site: { ...publicSiteData(site)!, home: { content: randomBytes(120_000).toString('base64') } } };
  expect(withPublicInitialData('<head></head>', '/story', data)).toBe('<head></head>');
});


it('counts the server snapshot cap in UTF-8 bytes, including non-ASCII content', () => {
  const data = { site: { ...publicSiteData(site)!, home: { content: 'é'.repeat(160_000) } } };
  expect(withPublicInitialData('<head></head>', '/story', data)).toBe('<head></head>');
});
