# Mobile experience and performance spec

Goal: louiemae.com (storefront) and louiemae.com/trade (House of Louie Mae) feel as
deliberate on a phone as on a desktop, and score 100 / 100 / 100 / 100 in Lighthouse
(Performance, Accessibility, Best Practices, SEO) on mobile and desktop.

## How this was measured

Production and the Convex deployment are not reachable from the build sandbox, so each
site is measured on a local production build (`vite build`) served with the same
rewrites, cache headers and gzip as Vercel, against a stub Convex sync server that
answers queries with fixture data. Lighthouse 12, default mobile (Moto G Power, slow 4G,
4x CPU) and desktop presets, Chromium headless. Numbers from PageSpeed Insights on
production will differ by a few points; the relative changes hold.

## Baseline audit (before this work)

| Page | Device | Perf | A11y | Best pr. | SEO | FCP | LCP |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Storefront `/` | mobile | 67 | 100* | 96 | 92 | 3.3 s | 7.6 s |
| Storefront `/` | desktop | 96 | 100* | 96 | 92 | 0.7 s | 1.4 s |
| Trade `/trade` | mobile | 68 | 98 | 100 | 92 | 4.2 s | 5.6 s |
| Trade `/trade` | desktop | 98 | 98 | 100 | 92 | 0.5 s | 1.1 s |

\* Accessibility read 100 only because the page rendered unstyled in the audit; once
styled it scored 83 (unnamed icon buttons, unlabeled inputs, contrast, heading order).

### Findings

Storefront
1. Tailwind ran from the Play CDN (`cdn.tailwindcss.com`): a render-blocking script that
   compiles every style on the phone at runtime. The CDN itself warns it is not for
   production.
2. One 1.1 MB JavaScript bundle (291 KB gzip): the admin, CJ tooling and every page loaded
   on the first visit to the home page.
3. Brand photography is served as the original PNGs: 5–9 MB per page on the home page
   alone (single images up to 9 MB), with no `srcset`.
4. Fonts came from Google Fonts (render-blocking third-party CSS).
5. No `robots.txt` or sitemap (the SPA rewrite answered `/robots.txt` with HTML).
6. Nothing paints until JavaScript has downloaded, booted and Convex has answered.
7. Icon-only buttons without names, inputs without labels, low-contrast helper text,
   skipped heading levels.
8. Hero sized with `100vh`, which jumps as iOS Safari's toolbars collapse.
9. Newsletter popup covers the whole phone after 10 seconds; the concierge button sits
   behind its backdrop as a dark blur.

Trade
1. The hero is a 13 MB scroll-scrubbed film per room (`preload="auto"`). iOS Safari never
   decodes frames for a video that hasn't played, so on iPhone the hero is a black void
   under the scrim (reported).
2. Nothing paints until the Convex catalog query returns ("Opening House of Louie Mae…").
3. 152 KB render-blocking stylesheet and Google Fonts.
4. Cutouts and scenes served at full desktop resolution to phones.
5. Heading order, `robots.txt` (shared with the storefront).

## Plan

Each step ships as its own pull request, reviewed and merged before the next.

### Step 1 — Storefront foundation (this PR)
- Build-time Tailwind (same theme), inline stylesheet in `index.html`.
- Self-hosted Latin font subsets in `public/fonts`, hero faces preloaded.
- Route-level code splitting; admin and secondary pages load on demand.
- Responsive WebP renditions of brand photography (`scripts/optimize-images.mjs`,
  `lib/responsiveImage.ts`), lazy loading below the fold.
- The home hero paints from HTML before the app loads; the app starts after first paint
  and takes over the identical hero. A saved hero photo fades in over the default.
- `robots.txt`, `sitemap.xml`, long-lived cache headers for hashed assets, fonts and media.
- Accessibility fixes found by the audit.

Result (local): mobile 99 / 100 / 100 / 100 (FCP 1.2 s), desktop 100 / 100 / 100 / 100.

### Step 2 — Trade hero on phones
- Phones scrub a still sequence (3:4 crops of each film, four per second, WebP, loaded
  coarse-to-fine; `scripts/build-film-frames.mjs`) drawn to a canvas. Works on every iOS
  version, Low Power Mode included; about 3 MB per room instead of 13 MB.
- Desktop keeps the film, fetched once the page has loaded; the poster is a real image and
  the film fades in only when it can draw a frame, so the hero is never black.
- `body{margin:0}`: removes the 8 px frame around the whole trade site.
- The space picker clears the phone tab bar.
- The opening frame, header and headline paint from HTML while the app and catalog load;
  the app starts after first paint and removes the shell in the same frame it renders.
- Fonts self-hosted (Newsreader, DM Sans), with a 20 KB static cut for the first-paint
  headline, a 2 KB cut of the wordmark, and metric-matched fallbacks; stylesheet inlined.

Result (local): mobile 99–100 / 100 / 100 / 100 (FCP 1.1 s, LCP 1.5 s), desktop
100 / 100 / 100 / 100.

Follow-up: phones get the same one-screen hero as desktop (headline, chapter dots, room
picker), with the room film playing straight through as one continuous video instead of
following the scroll (`PhoneFilm` in `trade/app.ts`). The phone cut (`trade/phoneCut.mjs`)
tells a shorter story, about 15 seconds: the blueprint rises into the clay model, then one
continuous generated shot pushes the camera down into the clay room while its furniture
and walls take on their colour in place (no dissolve, no empty room, no furniture arriving
piece by piece), then the film's own furnished room turns to night. The middle shot is
generated once per room and kept in `assets/phone-transitions/` (see `SOURCES.md` there);
it starts and ends on the film's own frames, so both joins are seamless. The generated
shots ease in and out, so the build retimes each one to a constant camera pace (travel
measured once per clip by `scripts/measure-transition-pace.py` into `pace.json`, frames
picked from a motion-interpolated copy), then lets it settle. The cut is a 720×960 crop,
about 2.3–4 MB per room, loaded after the page; the
headline and ink follow the film's chapters, and at the end it fades back to its opening
frame and plays again. Where it can't autoplay (Low Power Mode), the opening frame stays
with a play button.

### Step 3 — Storefront mobile experience
- Newsletter as a bottom sheet that appears after engagement, respects safe areas and
  never stacks on the concierge.
- Concierge button and panel sized for thumbs, safe-area aware.
- Header, menu and hero tuned for `svh`/safe areas; 44 px touch targets; product sheet
  and cart drawer full-height on phones.

### Step 4 — Trade polish
- Responsive cutouts and scenes for phones.
- Accessibility across the other trade pages (heading order, names, contrast).
- Phone pass over Discover, Studio, Boards, Tray, product sheets and the menu.

## Keeping it at 100
- Re-run `node scripts/optimize-images.mjs` after adding brand images and commit the
  output; reference images by their original `/images/brand/...` path.
- The home hero in `index.html` mirrors `components/HomePage.tsx`, and the trade shell in
  `trade/index.html` mirrors `Header`/`FilmStudy` in `trade/app.ts`; change them together.
- New or re-cut hero films: run `node scripts/build-film-frames.mjs <film>` and commit the
  phone cut (`trade/filmFrames.test.ts` fails until you do).
- New pages: import them with `lazy()` in `App.tsx`.
