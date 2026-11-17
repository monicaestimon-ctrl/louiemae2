// Shared browser/server markup uses createElement so Node function tracing resolves a .ts source for its .js import.
import type { Category } from '../types';
type Props = {
  collection: string;
  title: string;
  subtitle: string;
  categories: Category[];
  status?: React.ReactNode;
};
import React from 'react';
import { publicProductImage } from '../lib/productMetadata.js';
import { responsiveImage } from '../lib/responsiveImage.js';
function categoryHref(collection: string, category: Category) {
  const redirect = category.redirect?.replace(/^#/, '/');
  if (redirect && /^\/(?:collection\/[a-z0-9_-]+(?:\?[^#]*)?|blog|shop|story)$/.test(redirect))
    return redirect;
  return `/collection/${encodeURIComponent(collection)}?cat=${encodeURIComponent(category.id)}`;
}
function CollectionRootHero({
  collection,
  title,
  subtitle,
  categories: mainCategories,
  status,
}: Props) {
  return /* @__PURE__ */ React.createElement(
    React.Fragment,
    null,
    /* @__PURE__ */ React.createElement(
      'div',
      {
        className:
          'relative z-30 pt-32 pb-8 md:pb-12 text-center bg-transparent pointer-events-none',
      },
      /* @__PURE__ */ React.createElement(
        'div',
        null,
        /* @__PURE__ */ React.createElement(
          'h1',
          {
            className:
              'font-serif text-5xl md:text-7xl text-earth drop-shadow-sm mb-4 mix-blend-multiply opacity-90',
          },
          title
        ),
        /* @__PURE__ */ React.createElement(
          'p',
          {
            className:
              'font-sans text-earth/80 text-[10px] md:text-sm uppercase tracking-[0.3em] px-8 max-w-xs md:max-w-none mx-auto',
          },
          subtitle
        )
      )
    ),
    status,
    /* @__PURE__ */ React.createElement(
      'div',
      { className: 'pb-16 md:pb-24' },
      mainCategories.length <= 5
        ? /* @__PURE__ */ React.createElement(
            React.Fragment,
            null,
            /* @__PURE__ */ React.createElement(
              'div',
              { className: 'md:hidden' },
              /* @__PURE__ */ React.createElement(
                'div',
                { className: 'relative' },
                /* @__PURE__ */ React.createElement('div', {
                  className:
                    'absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-cream to-transparent z-10 pointer-events-none',
                }),
                /* @__PURE__ */ React.createElement('div', {
                  className:
                    'absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-cream to-transparent z-10 pointer-events-none',
                }),
                /* @__PURE__ */ React.createElement(
                  'div',
                  {
                    className: 'flex gap-4 overflow-x-auto scrollbar-hide px-8 pb-4 scroll-smooth',
                    style: {
                      scrollSnapType: 'x mandatory',
                      WebkitOverflowScrolling: 'touch',
                      perspective: '1200px',
                    },
                  },
                  mainCategories.map((cat, idx, arr) => {
                    const centerIdx = (arr.length - 1) / 2;
                    const offset = idx - centerIdx;
                    const rotateY = Math.max(-12, Math.min(12, offset * 4));
                    const translateZ = Math.min(0, Math.abs(offset) * -8);
                    return /* @__PURE__ */ React.createElement(
                      'a',
                      {
                        key: cat.id,
                        href: categoryHref(collection, cat),
                        className:
                          '\r\n                                group relative flex-shrink-0 overflow-hidden rounded-2xl\r\n                                w-[200px] aspect-[3/4]\r\n                                bg-stone-100\r\n                                shadow-lg hover:shadow-2xl\r\n                                transition-all duration-500 ease-out\r\n                                hover:scale-[1.02]\r\n                              ',
                        style: {
                          transform: `rotateY(${rotateY}deg) translateZ(${translateZ}px)`,
                          transformStyle: 'preserve-3d',
                          scrollSnapAlign: 'center',
                        },
                      },
                      publicProductImage(cat.image) &&
                        /* @__PURE__ */ React.createElement('img', {
                          ...responsiveImage(
                            publicProductImage(cat.image),
                            '(min-width: 768px) 33vw, 200px'
                          ),
                          loading: idx === 0 ? 'eager' : 'lazy',
                          fetchPriority: idx === 0 ? 'high' : void 0,
                          decoding: 'async',
                          alt: '',
                          className:
                            'absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110',
                        }),
                      /* @__PURE__ */ React.createElement('div', {
                        className:
                          'absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent',
                      }),
                      /* @__PURE__ */ React.createElement(
                        'div',
                        {
                          className:
                            'absolute inset-0 flex flex-col justify-end items-center text-center p-6',
                        },
                        /* @__PURE__ */ React.createElement(
                          'h2',
                          {
                            className:
                              'font-serif text-lg text-white font-light tracking-wide mb-2 whitespace-nowrap',
                          },
                          cat.title
                        ),
                        /* @__PURE__ */ React.createElement(
                          'p',
                          { className: 'text-white/70 text-xs uppercase tracking-[0.2em]' },
                          cat.caption || 'Shop Now'
                        )
                      )
                    );
                  })
                )
              )
            ),
            /* @__PURE__ */ React.createElement(
              'div',
              { className: 'hidden md:block px-8' },
              /* @__PURE__ */ React.createElement(
                'div',
                { className: 'container mx-auto' },
                /* @__PURE__ */ React.createElement(
                  'div',
                  {
                    className: `grid gap-6 ${mainCategories.length <= 3 ? 'grid-cols-3' : mainCategories.length <= 4 ? 'grid-cols-4' : 'grid-cols-5'}`,
                    style: { perspective: '1200px' },
                  },
                  mainCategories.map((cat, idx, arr) => {
                    const centerIdx = (arr.length - 1) / 2;
                    const offset = idx - centerIdx;
                    const rotateY = offset * 8;
                    const translateZ = Math.abs(offset) * -20;
                    return /* @__PURE__ */ React.createElement(
                      'a',
                      {
                        key: cat.id,
                        href: categoryHref(collection, cat),
                        className:
                          '\r\n                                group relative overflow-hidden rounded-2xl\r\n                                aspect-[2/3]\r\n                                bg-stone-100\r\n                                shadow-lg hover:shadow-2xl\r\n                                transition-all duration-500 ease-out\r\n                                hover:scale-[1.02]\r\n                              ',
                        style: {
                          transform: `rotateY(${rotateY}deg) translateZ(${translateZ}px)`,
                          transformStyle: 'preserve-3d',
                        },
                      },
                      publicProductImage(cat.image) &&
                        /* @__PURE__ */ React.createElement('img', {
                          ...responsiveImage(
                            publicProductImage(cat.image),
                            '(min-width: 768px) 33vw, 200px'
                          ),
                          loading: idx === 0 ? 'eager' : 'lazy',
                          fetchPriority: idx === 0 ? 'high' : void 0,
                          decoding: 'async',
                          alt: '',
                          className:
                            'absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110',
                        }),
                      /* @__PURE__ */ React.createElement('div', {
                        className:
                          'absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent',
                      }),
                      /* @__PURE__ */ React.createElement(
                        'div',
                        {
                          className:
                            'absolute inset-0 flex flex-col justify-end items-center text-center p-6',
                        },
                        /* @__PURE__ */ React.createElement(
                          'h2',
                          {
                            className:
                              'font-serif text-lg lg:text-xl text-white font-light tracking-wide mb-1 leading-tight whitespace-nowrap',
                          },
                          cat.title
                        ),
                        /* @__PURE__ */ React.createElement(
                          'p',
                          { className: 'text-white/70 text-xs uppercase tracking-[0.2em]' },
                          cat.caption || 'Shop Now'
                        ),
                        /* @__PURE__ */ React.createElement(
                          'div',
                          {
                            className:
                              'mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300',
                          },
                          /* @__PURE__ */ React.createElement(
                            'span',
                            {
                              className:
                                'inline-flex items-center text-white text-sm bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20',
                            },
                            'Explore',
                            /* @__PURE__ */ React.createElement(
                              'svg',
                              {
                                className:
                                  'w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform',
                                fill: 'none',
                                stroke: 'currentColor',
                                viewBox: '0 0 24 24',
                              },
                              /* @__PURE__ */ React.createElement('path', {
                                strokeLinecap: 'round',
                                strokeLinejoin: 'round',
                                strokeWidth: 2,
                                d: 'M17 8l4 4m0 0l-4 4m4-4H3',
                              })
                            )
                          )
                        )
                      )
                    );
                  })
                )
              )
            )
          )
        : /* >5 categories: Slidable Horizontal Carousel with grid-matched card sizes */
          /* @__PURE__ */ React.createElement(
            'div',
            { className: 'relative' },
            /* @__PURE__ */ React.createElement('div', {
              className:
                'absolute left-0 top-0 bottom-0 w-8 md:w-16 bg-gradient-to-r from-cream to-transparent z-10 pointer-events-none',
            }),
            /* @__PURE__ */ React.createElement('div', {
              className:
                'absolute right-0 top-0 bottom-0 w-8 md:w-16 bg-gradient-to-l from-cream to-transparent z-10 pointer-events-none',
            }),
            /* @__PURE__ */ React.createElement(
              'div',
              {
                className:
                  'flex gap-4 md:gap-6 overflow-x-auto scrollbar-hide px-8 md:px-16 pb-4 scroll-smooth',
                style: {
                  scrollSnapType: 'x mandatory',
                  WebkitOverflowScrolling: 'touch',
                  perspective: '1200px',
                },
              },
              mainCategories.map((cat, idx, arr) => {
                const centerIdx = (arr.length - 1) / 2;
                const offset = idx - centerIdx;
                const rotateY = Math.max(-12, Math.min(12, offset * 4));
                const translateZ = Math.min(0, Math.abs(offset) * -8);
                return /* @__PURE__ */ React.createElement(
                  'a',
                  {
                    key: cat.id,
                    href: categoryHref(collection, cat),
                    className:
                      '\r\n                            group relative flex-shrink-0 overflow-hidden rounded-2xl\r\n                            w-[200px] md:w-[calc((100vw-10rem)/5)] lg:w-[calc((1024px-10rem)/5)] xl:w-[calc((1280px-10rem)/5)]\r\n                            aspect-[3/4] md:aspect-[2/3]\r\n                            bg-stone-100\r\n                            shadow-lg hover:shadow-2xl\r\n                            transition-all duration-500 ease-out\r\n                            hover:scale-[1.02]\r\n                          ',
                    style: {
                      transform: `rotateY(${rotateY}deg) translateZ(${translateZ}px)`,
                      transformStyle: 'preserve-3d',
                      scrollSnapAlign: 'center',
                    },
                  },
                  publicProductImage(cat.image) &&
                    /* @__PURE__ */ React.createElement('img', {
                      ...responsiveImage(
                        publicProductImage(cat.image),
                        '(min-width: 768px) 33vw, 200px'
                      ),
                      loading: idx === 0 ? 'eager' : 'lazy',
                      fetchPriority: idx === 0 ? 'high' : void 0,
                      decoding: 'async',
                      alt: '',
                      className:
                        'absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110',
                    }),
                  /* @__PURE__ */ React.createElement('div', {
                    className:
                      'absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent',
                  }),
                  /* @__PURE__ */ React.createElement(
                    'div',
                    {
                      className:
                        'absolute inset-0 flex flex-col justify-end items-center text-center p-6 md:p-8',
                    },
                    /* @__PURE__ */ React.createElement(
                      'h2',
                      {
                        className:
                          'font-serif text-xl md:text-lg lg:text-xl text-white font-light tracking-wide mb-2 whitespace-nowrap',
                      },
                      cat.title
                    ),
                    /* @__PURE__ */ React.createElement(
                      'p',
                      { className: 'text-white/70 text-xs md:text-sm uppercase tracking-[0.2em]' },
                      cat.caption || 'Shop Now'
                    ),
                    /* @__PURE__ */ React.createElement(
                      'div',
                      {
                        className:
                          'mt-3 md:mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300',
                      },
                      /* @__PURE__ */ React.createElement(
                        'span',
                        { className: 'inline-flex items-center text-white text-xs md:text-sm' },
                        'Explore',
                        /* @__PURE__ */ React.createElement(
                          'svg',
                          {
                            className:
                              'w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform',
                            fill: 'none',
                            stroke: 'currentColor',
                            viewBox: '0 0 24 24',
                          },
                          /* @__PURE__ */ React.createElement('path', {
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            strokeWidth: 2,
                            d: 'M17 8l4 4m0 0l-4 4m4-4H3',
                          })
                        )
                      )
                    )
                  )
                );
              })
            )
          )
    )
  );
}
export { CollectionRootHero };
