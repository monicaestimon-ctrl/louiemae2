import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JournalIndexLead, JournalArticleHero } from '../JournalLead';
import manifest from '../../lib/editorialImageManifest.json';

afterEach(cleanup);
const [source, entry] = Object.entries(manifest)[0];
const post = {
  id: 'fixture',
  image: source,
  title: 'A thoughtful home',
  excerpt: '',
  category: 'Home',
  date: 'November 17, 2026',
};
for (const kind of ['index', 'article'] as const) {
  it(`${kind} keeps identical server/client format preference and reviewed crops`, () => {
    const element =
      kind === 'index' ? (
        <JournalIndexLead featuredPost={post} />
      ) : (
        <JournalArticleHero post={post} />
      );
    const template = document.createElement('template');
    template.innerHTML = renderToStaticMarkup(element);
    const serverPicture = template.content.querySelector('picture');
    const { container } = render(element);
    const imageContract = (root: globalThis.ParentNode) =>
      [...root.querySelectorAll('source, img')].map((node) => ({
        tag: node.tagName,
        attributes: Object.fromEntries(
          [...node.attributes].map((attribute) => [attribute.name, attribute.value])
        ),
      }));
    expect(serverPicture).not.toBeNull();
    expect(imageContract(container.querySelector('picture')!)).toEqual(
      imageContract(serverPicture!)
    );
    const sources = [...container.querySelectorAll('picture source')];
    expect(sources.map((node) => [node.getAttribute('type'), node.getAttribute('media')])).toEqual([
      ['image/avif', '(min-width: 768px)'],
      ['image/webp', '(min-width: 768px)'],
      ['image/avif', null],
    ]);
    expect(sources[0].getAttribute('srcset')).toContain(entry.windows[`${kind}Desktop`].avifBase);
    expect(sources[1].getAttribute('srcset')).toContain(entry.windows[`${kind}Desktop`].base);
    expect(sources[2].getAttribute('srcset')).toContain(entry.windows[`${kind}Mobile`].avifBase);
    const img = container.querySelector('picture img');
    expect(img?.getAttribute('srcset')).toContain(entry.windows[`${kind}Mobile`].base);
    expect(img?.getAttribute('alt')).toBe(kind === 'index' ? '' : post.title);
    expect(img?.getAttribute('loading')).toBe('eager');
    const sizes =
      kind === 'index'
        ? '(min-width: 1376px) 1280px, (min-width: 768px) calc(100vw - 96px), calc(100vw - 48px)'
        : '100vw';
    expect(img?.getAttribute('sizes')).toBe(sizes);
    expect(sources.every((node) => node.getAttribute('sizes') === sizes)).toBe(true);
    expect(template.content.querySelector('link[rel="preload"][as="image"]')).toBeNull();
  });
}
it('does not substitute reviewed crops for a replacement upload', () => {
  const replacement = { ...post, image: `${source}-replacement` };
  const { container } = render(<JournalArticleHero post={replacement} />);
  expect(container.querySelector('picture')).toBeNull();
  expect(container.querySelector('img')?.getAttribute('src')).toBe(replacement.image);
  expect(container.innerHTML).not.toContain('/images/opt/editorial/');
});

it('falls back from failed AVIF to WebP, bounds failures, and resets for a replacement source', () => {
  const view = render(<JournalArticleHero post={post} />);
  fireEvent.error(view.container.querySelector('picture img')!);
  expect(view.container.querySelector('source[type="image/avif"]')).toBeNull();
  expect(view.container.querySelector('picture img')?.getAttribute('src')).toContain(
    entry.windows.articleMobile.base
  );
  fireEvent.error(view.container.querySelector('picture img')!);
  expect(view.container.querySelector('img')).toBeNull();
  expect(screen.getByRole('img', { name: `${post.title}: image unavailable` })).toHaveTextContent(
    'Image unavailable'
  );
  view.rerender(<JournalArticleHero post={{ ...post, image: `${source}-new` }} />);
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${source}-new`);
  fireEvent.error(view.container.querySelector('img')!);
  expect(view.container.querySelector('img')).toBeNull();
});
