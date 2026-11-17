import type { FunctionReturnType } from 'convex/server';
import type { api } from '../convex/_generated/api';
export type PublicSiteData = Pick<
  NonNullable<FunctionReturnType<typeof api.siteContent.get>>,
  'navLinks' | 'collections' | 'home' | 'story'
>;
export type PublicPosts = FunctionReturnType<typeof api.blogPosts.publicSummaries>;
export type PublicArticle = NonNullable<FunctionReturnType<typeof api.blogPosts.publicDetail>>;
export type PublicInitialData = {
  site?: PublicSiteData;
  posts?: PublicPosts;
  article?: PublicArticle;
};
export const PUBLIC_INITIAL_ID = 'lm-public-initial-data';
const LIMIT = 300_000;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
// Explicit display contracts mirror types.ts. Unknown keys and wrong primitive types
// are discarded recursively; no stored object is copied wholesale into HTML.
type DisplayShape =
  | 'string'
  | 'boolean'
  | { readonly [key: string]: DisplayShape }
  | readonly [DisplayShape];
const sectionItem = {
  image: 'string',
  title: 'string',
  subtitle: 'string',
  link: 'string',
} as const;
const section = {
  id: 'string',
  type: 'string',
  heading: 'string',
  subheading: 'string',
  content: 'string',
  image: 'string',
  productId: 'string',
  layout: 'string',
  items: [sectionItem],
} as const;
const category = {
  id: 'string',
  title: 'string',
  image: 'string',
  caption: 'string',
  collection: 'string',
  redirect: 'string',
  parentCategory: 'string',
  parentCategoryId: 'string',
  isMainCategory: 'boolean',
} as const;
const home = {
  hero: {
    image: 'string',
    pretitle: 'string',
    titleLine1: 'string',
    titleLine2: 'string',
    buttonText: 'string',
  },
  intro: { text: 'string' },
  categoryImages: {
    furniture: 'string',
    decor: 'string',
    fashion: 'string',
    kids: 'string',
    journal: 'string',
  },
  brand: { image: 'string' },
  shop: { headerImage: 'string' },
  sections: [section],
} as const;
const story = {
  hero: { image: 'string', title: 'string', subtitle: 'string' },
  prologue: { quote: 'string', subtext: 'string' },
  chapters: {
    oneTitle: 'string',
    oneText: 'string',
    twoTitle: 'string',
    twoText: 'string',
    threeTitle: 'string',
    threeText: 'string',
    fourTitle: 'string',
    fourText: 'string',
  },
  sections: [section],
} as const;
function display(value: unknown, shape: DisplayShape): unknown {
  if (typeof shape === 'string') return typeof value === shape ? value : undefined;
  if (Array.isArray(shape))
    return Array.isArray(value)
      ? value
          .slice(0, 100)
          .map((item) => display(item, shape[0]))
          .filter((item) => item !== undefined)
      : undefined;
  if (!record(value)) return undefined;
  return Object.fromEntries(
    Object.entries(shape).flatMap(([key, child]) => {
      const projected = display(value[key], child);
      return projected === undefined ? [] : [[key, projected]];
    })
  );
}
function navigation(value: unknown, depth = 0): unknown[] {
  if (!Array.isArray(value) || depth >= 10) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (!record(item) || typeof item.label !== 'string' || typeof item.href !== 'string') return [];
    return [
      {
        label: item.label,
        href: item.href,
        ...(Array.isArray(item.children) ? { children: navigation(item.children, depth + 1) } : {}),
      },
    ];
  });
}
/** Only public display DTOs belong here. Never add account, pricing or purchase authority. */
export function publicSiteData(value: unknown): PublicSiteData | undefined {
  if (
    !record(value) ||
    !Array.isArray(value.navLinks) ||
    value.navLinks.length > 100 ||
    !Array.isArray(value.collections) ||
    value.collections.length > 100 ||
    !record(value.home) ||
    !record(value.story)
  )
    return;
  return {
    navLinks: navigation(value.navLinks),
    collections: display(value.collections, [
      {
        id: 'string',
        title: 'string',
        subtitle: 'string',
        heroImage: 'string',
        subcategories: [category],
      },
    ]),
    home: display(value.home, home),
    story: display(value.story, story),
  } as PublicSiteData;
}
function publicPost(value: unknown, article: boolean) {
  if (
    !record(value) ||
    value.status !== 'published' ||
    typeof value._id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(value._id) ||
    !['title', 'excerpt', 'image', 'category', 'date'].every(
      (key) => typeof value[key] === 'string'
    )
  )
    return false;
  return article
    ? typeof value.contentHtml === 'string'
    : typeof value._creationTime === 'number' &&
        Number.isFinite(value._creationTime) &&
        value.content === '';
}
/** Initial response data is usable only on its original path and briefly during the first connection. */
export function parsePublicInitialData(
  text: string,
  path: string,
  now = Date.now()
): PublicInitialData | undefined {
  if (text.length > LIMIT) return;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      !record(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(parsed.revision) ||
      parsed.path !== path ||
      typeof parsed.at !== 'number' ||
      !Number.isFinite(parsed.at) ||
      parsed.at > now + 5000 ||
      now - parsed.at > 30_000 ||
      !record(parsed.data)
    )
      return;
    const data: PublicInitialData = {};
    if (path === '/shop' || path === '/story') data.site = publicSiteData(parsed.data.site);
    if (
      path === '/blog' &&
      Array.isArray(parsed.data.posts) &&
      parsed.data.posts.length <= 250 &&
      parsed.data.posts.every((value) => publicPost(value, false))
    )
      data.posts = parsed.data.posts as PublicPosts;
    if (
      /^\/blog\/[a-zA-Z0-9_-]{1,128}$/.test(path) &&
      publicPost(parsed.data.article, true) &&
      (parsed.data.article as PublicArticle)._id === path.slice(6)
    )
      data.article = parsed.data.article as PublicArticle;
    return data;
  } catch {
    return;
  }
}
export function readPublicInitialData(): PublicInitialData | undefined {
  if (typeof document === 'undefined') return;
  const element = document.getElementById(PUBLIC_INITIAL_ID);
  return element?.tagName === 'SCRIPT' && element.getAttribute('type') === 'application/json'
    ? parsePublicInitialData(element.textContent || '', window.location.pathname)
    : undefined;
}
