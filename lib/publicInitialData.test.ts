import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { parsePublicInitialData, publicSiteData, PUBLIC_INITIAL_ID } from './publicInitialData';
import { withPublicInitialData } from './serverPublicInitialData';
const site = {
  navLinks: [],
  collections: [],
  home: { hero: { titleLine1: '</script><script>bad()</script>' } },
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
  expect(parsePublicInitialData(text, '/story', 1000)?.site?.home.hero.titleLine1).toBe(
    site.home.hero.titleLine1
  );
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
  const data = {
    site: { ...publicSiteData(site)!, home: { content: randomBytes(120_000).toString('base64') } },
  };
  expect(withPublicInitialData('<head></head>', '/story', data)).toBe('<head></head>');
});

it('counts the server snapshot cap in UTF-8 bytes, including non-ASCII content', () => {
  const data = { site: { ...publicSiteData(site)!, home: { content: 'é'.repeat(160_000) } } };
  expect(withPublicInitialData('<head></head>', '/story', data)).toBe('<head></head>');
});

it('projects nested display fields without private objects or unexpected primitive types', () => {
  const secret = {
    privateCost: 91234,
    account: { token: 'private-token' },
    project: { owner: 'private-owner' },
  };
  const data = publicSiteData({
    navLinks: [
      {
        label: 'Shop',
        href: '/shop',
        ...secret,
        children: [{ label: 'Child', href: '/story', ...secret }],
      },
    ],
    collections: [
      {
        id: 'decor',
        title: 'Decor',
        subtitle: 'Objects',
        heroImage: '/hero.webp',
        ...secret,
        subcategories: [
          {
            id: 'lighting',
            title: 'Lighting',
            image: '/lamp.webp',
            isMainCategory: true,
            ...secret,
          },
        ],
      },
    ],
    home: {
      ...secret,
      hero: { titleLine1: 'Home', image: secret, ...secret },
      intro: { text: 'Welcome', ...secret },
      sections: [
        {
          id: 'grid',
          type: 'grid',
          ...secret,
          items: [{ title: 'Object', image: '/object.webp', ...secret }],
        },
      ],
    },
    story: {
      ...secret,
      hero: { title: 'Story', ...secret },
      chapters: { oneText: 'Chapter', ...secret },
      sections: [{ id: 'text', type: 'text', content: 'Public', ...secret }],
    },
  })!;
  const html = withPublicInitialData('<head></head>', '/shop', { site: data }, 1000);
  for (const forbidden of [
    'privateCost',
    '91234',
    'account',
    'private-token',
    'project',
    'private-owner',
  ])
    expect(html).not.toContain(forbidden);
  expect(data.home.hero).toEqual({ titleLine1: 'Home' });
  expect(data.collections[0].subcategories[0].isMainCategory).toBe(true);
  expect(data.navLinks[0].children?.[0]).toEqual({ label: 'Child', href: '/story' });
  expect(
    parsePublicInitialData(
      new globalThis.DOMParser()
        .parseFromString(html, 'text/html')
        .getElementById(PUBLIC_INITIAL_ID)!.textContent!,
      '/shop',
      1000
    )?.site
  ).toEqual(data);
});

it('binds collection configuration to its exact valid route without seeding product pages', () => {
  const { text } = encoded('/collection/furniture');
  expect(parsePublicInitialData(text, '/collection/furniture', 1000)?.site).toBeDefined();
  expect(parsePublicInitialData(text, '/collection/decor', 1000)).toBeUndefined();
  expect(parsePublicInitialData(text, '/collection/furniture', 31_001)).toBeUndefined();
  expect(parsePublicInitialData(encoded('/collection/INVALID').text, '/collection/INVALID', 1000)).toEqual({});
});
