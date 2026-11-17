import editorialManifest from '../lib/editorialImageManifest.json' with { type: 'json' };
import React from 'react';
import { ArrowRight, Calendar, Clock } from 'lucide-react';
import { responsiveImage } from '../lib/responsiveImage.js';
import { journalUrl } from '../lib/journalUrl.js';
export type JournalLeadPost = {
  id: string;
  image: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
};
// Shared initial-document and interactive geometry. Keep this runtime module plain .ts.
export function JournalIndexLead({
  featuredPost,
  onNavigate,
}: {
  featuredPost: JournalLeadPost;
  onNavigate?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'section',
      { className: 'px-6 md:px-12 mb-20 text-center relative' },
      React.createElement('div', {
        'aria-hidden': 'true',
        className: 'mx-auto mb-6 h-10 w-px bg-gradient-to-b from-transparent to-bronze/40',
      }),
      React.createElement(
        'div',
        null,
        React.createElement(
          'span',
          { className: 'text-muted-earth text-xs tracking-[0.4em] uppercase mb-4 block font-sans' },
          'Blog'
        ),
        React.createElement(
          'h1',
          {
            className:
              'font-serif text-5xl sm:text-6xl md:text-8xl text-earth mb-6 leading-tight tracking-tight',
          },
          'Simply Mae'
        ),
        React.createElement(
          'div',
          { className: 'flex items-center justify-center gap-4 mb-6' },
          React.createElement('div', { className: 'h-px w-8 bg-earth/20' }),
          React.createElement(
            'p',
            { className: 'font-serif text-muted-earth text-xl italic' },
            'Curated Reflections'
          ),
          React.createElement('div', { className: 'h-px w-8 bg-earth/20' })
        ),
        React.createElement(
          'p',
          {
            className:
              'font-sans text-muted-earth max-w-lg mx-auto leading-relaxed text-sm tracking-wide min-h-[4.875em] min-[400px]:min-h-[3.25em]',
          },
          'On faith, family, design, and finding beauty in the everyday rhythms of life.'
        )
      )
    ),
    React.createElement(
      'section',
      { className: 'px-6 md:px-12 mb-28' },
      React.createElement(
        'div',
        { className: 'container mx-auto' },
        React.createElement(
          'div',
          { className: 'group cursor-pointer relative' },
          React.createElement(
            'a',
            { className: 'block', href: journalUrl(featuredPost.id), onClick: onNavigate },
            React.createElement(
              'div',
              {
                className:
                  'relative aspect-[4/5] md:aspect-[21/9] overflow-hidden rounded-sm mb-10 shadow-sm',
              },
              React.createElement('div', {
                className:
                  'absolute inset-0 bg-black/10 group-hover:bg-black/5 transition-colors z-10',
              }),
              React.createElement(JournalImage, {
                src: featuredPost.image,
                alt: '',
                kind: 'index',
                className:
                  'w-full h-full object-cover transition-transform duration-[1.5s] ease-out group-hover:scale-105',
              }),
              React.createElement(
                'div',
                { className: 'absolute top-6 left-6 md:top-10 md:left-10 z-20' },
                React.createElement(
                  'div',
                  {
                    className:
                      'bg-white/95 backdrop-blur-md px-5 py-3 shadow-sm border border-white/50',
                  },
                  React.createElement(
                    'span',
                    { className: 'text-earth text-[10px] uppercase tracking-[0.25em]' },
                    'Featured Story'
                  )
                )
              )
            ),
            React.createElement(
              'div',
              { className: 'text-center max-w-4xl mx-auto px-4' },
              React.createElement(
                'div',
                {
                  className:
                    'flex items-center justify-center gap-4 mb-4 text-muted-earth text-[10px] uppercase tracking-widest font-sans',
                },
                React.createElement('span', null, featuredPost.category),
                React.createElement('span', {
                  className: 'w-1 h-1 rounded-full bg-bronze/40',
                }),
                React.createElement('span', null, featuredPost.date)
              ),
              React.createElement(
                'h2',
                {
                  className:
                    'font-serif text-4xl md:text-6xl text-earth mb-6 group-hover:text-bronze transition-colors duration-300 leading-tight',
                },
                featuredPost.title
              ),
              React.createElement(
                'p',
                {
                  className:
                    'font-sans text-muted-earth leading-loose mb-8 text-sm md:text-base max-w-2xl mx-auto',
                },
                featuredPost.excerpt
              ),
              React.createElement(
                'span',
                {
                  className:
                    'inline-flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-earth border-b border-earth/20 pb-2 hover:text-bronze hover:border-bronze hover:gap-4 transition-all duration-300',
                },
                'Read The Story ',
                React.createElement(ArrowRight, { className: 'w-3 h-3' })
              )
            )
          )
        )
      )
    )
  );
}
export function JournalArticleHero({ post }: { post: JournalLeadPost }) {
  return React.createElement(
    React.Fragment,
    null,
    post.image &&
      React.createElement(
        'div',
        { className: 'w-full aspect-[16/9] md:aspect-[3/1] overflow-hidden relative' },
        React.createElement('div', {
          className:
            'absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-cream z-10',
        }),
        React.createElement(JournalImage, {
          src: post.image,
          alt: post.title,
          kind: 'article',
          className: 'w-full h-full object-cover',
        })
      )
  );
}
export function JournalArticleHeading({
  post,
  readingTime,
  headingRef,
}: {
  post: JournalLeadPost;
  readingTime: number;
  headingRef?: React.Ref<globalThis.HTMLHeadingElement>;
}) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      {
        className: 'text-center mb-8 md:mb-12',
      },
      React.createElement(
        'div',
        {
          className:
            'flex flex-wrap items-center justify-center gap-2 md:gap-4 mb-6 text-muted-earth text-[10px] uppercase tracking-widest font-sans',
        },
        React.createElement('span', null, post.category),
        React.createElement('span', {
          className: 'w-1 h-1 rounded-full bg-bronze/40',
        }),
        React.createElement(
          'span',
          { className: 'flex items-center gap-1' },
          React.createElement(Calendar, { className: 'w-3 h-3' }),
          post.date
        ),
        React.createElement('span', {
          className: 'w-1 h-1 rounded-full bg-bronze/40',
        }),
        React.createElement(
          'span',
          { className: 'flex items-center gap-1' },
          React.createElement(Clock, { className: 'w-3 h-3' }),
          readingTime,
          ' min read'
        )
      ),
      React.createElement(
        'h1',
        {
          ref: headingRef,
          tabIndex: -1,
          className: 'font-serif text-4xl md:text-6xl text-earth mb-6 leading-tight',
        },
        post.title
      ),
      post.excerpt &&
        React.createElement(
          'p',
          {
            className:
              'font-serif text-muted-earth text-base md:text-xl italic leading-relaxed max-w-2xl mx-auto',
          },
          post.excerpt
        ),
      React.createElement(
        'div',
        { className: 'flex items-center justify-center gap-3 mt-6 md:mt-10' },
        React.createElement('div', { className: 'h-px w-16 bg-earth/10' }),
        React.createElement('div', {
          className: 'w-1.5 h-1.5 rounded-full bg-bronze/30',
        }),
        React.createElement('div', { className: 'h-px w-16 bg-earth/10' })
      )
    )
  );
}

type WindowImage = { base: string; widths: number[]; ratio: number };
type EditorialImage = {
  windows: Record<'indexMobile' | 'indexDesktop' | 'articleMobile' | 'articleDesktop', WindowImage>;
};
function JournalImage({
  src,
  alt,
  kind,
  className,
}: {
  src: string;
  alt: string;
  kind: 'index' | 'article';
  className: string;
}) {
  const entries = editorialManifest as Record<string, EditorialImage>;
  const entry = Object.hasOwn(entries, src) ? entries[src] : undefined;
  const attrs = {
    loading: 'eager' as const,
    fetchPriority: 'high' as const,
    decoding: 'async' as const,
    alt,
    className,
  };
  if (!entry)
    return React.createElement('img', {
      ...attrs,
      ...responsiveImage(src, '100vw'),
      src: responsiveImage(src).src || undefined,
    });
  const mobile = entry.windows[`${kind}Mobile`];
  const desktop = entry.windows[`${kind}Desktop`];
  const set = (image: WindowImage) =>
    image.widths.map((width) => `${image.base}-${width}.webp ${width}w`).join(', ');
  return React.createElement(
    'picture',
    { className: 'block w-full h-full' },
    React.createElement('source', {
      media: '(min-width: 768px)',
      srcSet: set(desktop),
      sizes: '100vw',
    }),
    React.createElement('img', {
      ...attrs,
      src: `${mobile.base}-${mobile.widths.at(-1)}.webp`,
      srcSet: set(mobile),
      sizes: '100vw',
    })
  );
}

export function JournalArchive({
  recentPosts,
  onNavigate,
}: {
  recentPosts: JournalLeadPost[];
  onNavigate?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return React.createElement(
    React.Fragment,
    null,
    '         ',
    React.createElement(
      'section',
      { className: 'px-6 md:px-12 pb-24' },
      React.createElement(
        'div',
        { className: 'container mx-auto' },
        React.createElement(
          'div',
          { className: 'mb-12 flex items-baseline justify-between border-b border-earth/10 pb-4' },
          React.createElement(
            'h2',
            { className: 'font-serif text-3xl text-earth' },
            'More stories'
          ),
          React.createElement(
            'span',
            {
              className:
                'text-[10px] uppercase tracking-widest text-muted-earth hidden md:inline-block',
            },
            'Archive'
          )
        ),
        React.createElement(
          'div',
          { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-16' },
          recentPosts.map((post) =>
            React.createElement(
              'div',
              { key: post.id, className: 'group cursor-pointer flex flex-col h-full' },
              React.createElement(
                'a',
                {
                  className: 'flex flex-col h-full',
                  href: journalUrl(post.id),
                  onClick: onNavigate,
                },
                React.createElement(
                  'div',
                  {
                    className:
                      'aspect-[3/4] overflow-hidden rounded-sm mb-6 relative shadow-[0_2px_10px_rgba(0,0,0,0.03)]',
                  },
                  React.createElement('img', {
                    loading: 'lazy',
                    decoding: 'async',
                    ...responsiveImage(
                      post.image,
                      '(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw'
                    ),
                    alt: '',
                    className:
                      'w-full h-full object-cover transition-transform duration-700 group-hover:scale-105',
                  }),
                  React.createElement(
                    'div',
                    {
                      className:
                        'absolute top-4 left-4 bg-cream/95 backdrop-blur-sm px-3 py-1.5 text-[9px] uppercase tracking-widest text-earth shadow-sm',
                    },
                    post.category
                  )
                ),
                React.createElement(
                  'div',
                  { className: 'flex flex-col flex-1 items-start pr-4' },
                  React.createElement(
                    'div',
                    {
                      className:
                        'flex items-center gap-2 mb-3 text-[9px] uppercase tracking-widest text-muted-earth',
                    },
                    React.createElement(Calendar, { className: 'w-3 h-3' }),
                    React.createElement('span', null, post.date)
                  ),
                  React.createElement(
                    'h3',
                    {
                      className:
                        'font-serif text-2xl md:text-3xl text-earth mb-4 leading-tight group-hover:text-bronze transition-colors duration-300',
                    },
                    post.title
                  ),
                  React.createElement(
                    'p',
                    {
                      className:
                        'font-sans text-muted-earth text-sm leading-relaxed mb-6 line-clamp-3',
                    },
                    post.excerpt
                  ),
                  React.createElement(
                    'div',
                    {
                      className:
                        'mt-auto pt-4 w-full border-t border-earth/5 flex justify-between items-center ',
                    },
                    React.createElement(
                      'span',
                      { className: 'text-[9px] uppercase tracking-widest text-earth' },
                      'Read Article'
                    ),
                    React.createElement(ArrowRight, {
                      className:
                        'w-3 h-3 text-bronze -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300',
                    })
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}
export function JournalEmptyContent({
  message = 'New stories are coming soon.',
}: {
  message?: string;
}) {
  return React.createElement(
    'div',
    null,
    React.createElement('h1', { className: 'font-serif text-4xl text-earth' }, 'Simply Mae'),
    React.createElement('p', { role: 'status', className: 'mt-6 text-earth' }, message),
    React.createElement(
      'a',
      { href: '/shop', className: 'mt-6 inline-block underline text-earth' },
      'Continue shopping'
    )
  );
}
