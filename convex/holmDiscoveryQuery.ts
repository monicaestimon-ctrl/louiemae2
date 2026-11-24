import { v } from 'convex/values';
import { query, internalQuery, internalMutation } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { discoveryState, discoveryProjection, sameDiscovery, HOLM_DISCOVERY_VERSION } from './holmDiscoveryMaintenance';
import { catalogItem } from './holmCatalogRead';
import { viewer, isVerified } from './holmAccess';
import { catalogPageOptions } from '../lib/catalogPagination';
import { discoveryToneOrder, matchesDiscoveryFacets, normalizeDiscoveryRequest } from '../lib/holmDiscoveryFilters';
import { discoverySearchQuery, matchesDiscoverySearch } from '../lib/holmDiscoverySearch';
import { decodeDiscoveryCursor, encodeDiscoveryCursor } from '../lib/holmDiscoveryCursor';
import { representativeDiscoveryVariant } from '../lib/holmDiscoveryPrice';
import { holmKnownTones } from '../lib/holmCatalogFacets';
import { holmLegacyId } from '../lib/holmProductIdentity';
import { CommerceError } from '../lib/errors';
import { digest } from './dlvSecurity';
import { audit } from './sysCore';

const request = v.object({ query: v.string(), type: v.string(), materials: v.array(v.string()), tones: v.array(v.string()),
  photoPalette: v.array(v.string()), maximumMinor: v.union(v.number(), v.null()), inStock: v.boolean(),
  sort: v.union(v.literal('relevance'), v.literal('priceAsc'), v.literal('priceDesc')), channel: v.union(v.literal('retail'), v.literal('trade')) });
async function readerState(ctx: Pick<QueryCtx, 'db'>) {
  const metadata = await discoveryState(ctx);
  const offers = await ctx.db.query('holmDiscoveryOfferState').withIndex('by_version', q => q.eq('version', 1)).unique();
  return { metadata, offers, ready: Boolean(metadata?.readerEnabled && metadata.phase === 'verified' && offers?.phase === 'verified'
    && metadata.readerOfferGeneration === offers.generation) };
}
export const readiness = query({ args: {}, handler: async ctx => ({ ready: (await readerState(ctx)).ready, version: HOLM_DISCOVERY_VERSION }) });

/** Deployment-admin switch only; verification never implicitly enables customer reads. */
export const setReaderEnabled = internalMutation({
  args: { enabled: v.boolean(), metadataGeneration: v.number(), offerGeneration: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const { metadata, offers } = await readerState(ctx);
    if (!metadata || !offers || metadata.generation !== args.metadataGeneration || offers.generation !== args.offerGeneration
      || !args.reason.trim() || args.reason.length > 500) throw new CommerceError('INVALID_INPUT');
    if (args.enabled && (metadata.phase !== 'verified' || offers.phase !== 'verified' || metadata.mismatchIds.length || offers.mismatchIds.length)) throw new CommerceError('TEMPORARILY_UNAVAILABLE');
    if (metadata.readerEnabled === args.enabled && metadata.readerOfferGeneration === offers.generation) return { changed: false };
    await ctx.db.patch(metadata._id, { readerEnabled: args.enabled, readerOfferGeneration: offers.generation, updatedAt: Date.now() });
    await audit(ctx, { actor: 'deployment-maintenance', action: 'holm.discovery.reader', entityTable: 'holmDiscoveryState', entityId: metadata._id,
      before: { enabled: metadata.readerEnabled ?? false }, after: { enabled: args.enabled, metadataGeneration: metadata.generation, offerGeneration: offers.generation }, reason: args.reason });
    return { changed: true };
  },
});

/** One bounded candidate page. Empty filtered pages keep their continuation. */
export const page = query({
  args: { request, cursor: v.union(v.string(), v.null()), pageSize: v.number(), refreshToken: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const state = await readerState(ctx);
    const empty = { items: [], nextCursor: null, serverNow: Date.now(), refreshAfterMs: 30_000 };
    if (!state.ready) return { ...empty, ready: false };
    const me = await viewer(ctx); const trade = Boolean(me && isVerified(me.profile));
    if (args.request.channel === 'trade' && !trade) throw new CommerceError('TRADE_APPROVAL_REQUIRED');
    if (!Number.isSafeInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 24
      || (args.refreshToken !== undefined && (!Number.isSafeInteger(args.refreshToken) || args.refreshToken < 0))) throw new CommerceError('INVALID_INPUT');
    let filter;
    try { filter = normalizeDiscoveryRequest(args.request); } catch { throw new CommerceError('INVALID_INPUT'); }
    const priceOrdered = filter.sort !== 'relevance';
    const photoOrdered = !priceOrdered && filter.photoPalette.length > 0;
    const groups = photoOrdered ? discoveryToneOrder(holmKnownTones(), filter.photoPalette) : [''];
    const binding = await digest({ filter, pageSize: args.pageSize, viewer: me?.userId ?? 'anonymous', trade,
      version: HOLM_DISCOVERY_VERSION, metadataGeneration: state.metadata!.generation, offerGeneration: state.offers!.generation });
    let cursor;
    try { cursor = decodeDiscoveryCursor(args.cursor, binding, groups.length); } catch { throw new CommerceError('INVALID_INPUT'); }
    if (!filter.query.empty && !filter.query.terms.length) return { ...empty, ready: true };
    const options = catalogPageOptions({ cursor: cursor.cursor, numItems: args.pageSize }, 24, 1_000_000);
    const source = await (async () => {
      if (priceOrdered) {
        const maximum = filter.maximumMinor;
        const priceQuery = filter.channel === 'trade'
          ? ctx.db.query('holmDiscoveryOffers').withIndex('by_trade', q => maximum === null ? q.gt('tradeMinor', 0) : q.gt('tradeMinor', 0).lte('tradeMinor', maximum))
          : ctx.db.query('holmDiscoveryOffers').withIndex('by_retail', q => maximum === null ? q.gt('retailMinor', 0) : q.gt('retailMinor', 0).lte('retailMinor', maximum));
        return priceQuery.order(filter.sort === 'priceAsc' ? 'asc' : 'desc').paginate(options);
      }
      if (photoOrdered) return ctx.db.query('holmDiscoveryIndex').withIndex('by_tone_name', q => q.eq('version', HOLM_DISCOVERY_VERSION).eq('tone', groups[cursor.group])).paginate(options);
      if (filter.query.text) return ctx.db.query('holmDiscoveryIndex').withSearchIndex('search_text', q => {
        let search = q.search('text', filter.query.text).eq('version', HOLM_DISCOVERY_VERSION);
        if (filter.type !== 'all') search = search.eq('type', filter.type);
        if (filter.materials.length === 1) search = search.eq('material', filter.materials[0]);
        return search;
      }).paginate(options);
      if (filter.type !== 'all') return ctx.db.query('holmDiscoveryIndex').withIndex('by_type_name', q => q.eq('version', HOLM_DISCOVERY_VERSION).eq('type', filter.type)).paginate(options);
      if (filter.materials.length === 1) return ctx.db.query('holmDiscoveryIndex').withIndex('by_material_name', q => q.eq('version', HOLM_DISCOVERY_VERSION).eq('material', filter.materials[0])).paginate(options);
      return ctx.db.query('holmDiscoveryIndex').withIndex('by_name', q => q.eq('version', HOLM_DISCOVERY_VERSION)).paginate(options);
    })();
    const now = Date.now(); const items = []; let refreshAfterMs = 30_000;
    const resolved = new Map<string, Awaited<ReturnType<typeof catalogItem>>>();
    for (const row of source.page) {
      const listing = await ctx.db.get(row.listingId);
      if (!listing || !listing.published || listing.channel !== 'house') continue;
      const metadata = 'variantId' in row ? await ctx.db.query('holmDiscoveryIndex').withIndex('by_listing', q => q.eq('listingId', row.listingId)).unique() : row;
      if (!sameDiscovery(metadata, discoveryProjection(listing))) throw new CommerceError('TEMPORARILY_UNAVAILABLE');
      if (!metadata || !matchesDiscoveryFacets(filter, metadata) || !matchesDiscoverySearch(filter.query, metadata.text)) continue;
      if (!resolved.has(listing._id)) resolved.set(listing._id, await catalogItem(ctx, listing, trade, now));
      const item = resolved.get(listing._id);
      if (!item || (filter.inStock && !item.inStock)) continue;
      const selected = representativeDiscoveryVariant(item.variants, filter.channel);
      if (!selected) continue;
      const price = selected[filter.channel]!;
      if (filter.maximumMinor !== null && price > filter.maximumMinor) continue;
      if ('variantId' in row) {
        if (row.variantId !== selected.id) continue;
      }
      const offer = 'variantId' in row ? row : await ctx.db.query('holmDiscoveryOffers')
        .withIndex('by_listing', q => q.eq('listingId', listing._id).eq('variantId', selected.id)).unique();
      if (!offer || (filter.channel === 'trade' ? offer.tradeMinor : offer.retailMinor) !== price) throw new CommerceError('TEMPORARILY_UNAVAILABLE');
      const deadline = filter.channel === 'trade' ? offer.tradeTo : offer.retailTo;
      if (deadline !== null) refreshAfterMs = Math.min(refreshAfterMs, Math.max(100, deadline - now));
      const identities = await ctx.db.query('holmCatalogIdentities').withIndex('by_legacy', q => q.eq('legacyId', holmLegacyId(item.id))).take(2);
      if (identities.length !== 1 || identities[0].productId !== item.id) continue;
      items.push({ ...item, defaultVariantId: selected.id });
    }
    const nextCursor = source.isDone
      ? cursor.group + 1 < groups.length ? encodeDiscoveryCursor(binding, cursor.group + 1, null) : null
      : encodeDiscoveryCursor(binding, cursor.group, source.continueCursor);
    if (nextCursor !== null && nextCursor === args.cursor) throw new CommerceError('TEMPORARILY_UNAVAILABLE');
    return { ready: true, items, nextCursor, serverNow: now, refreshAfterMs };
  },
});

/** Read-only deployment evidence: compare native search membership with the
 * price-path predicate before reader activation. convex-test does not implement
 * production multi-term search semantics, so its mock cannot certify this parity. */
export const searchParityPage = internalQuery({
  args: { query: v.string(), cursor: v.union(v.string(), v.null()), mode: v.union(v.literal('native'), v.literal('predicate')) },
  handler: async (ctx, args) => {
    const state = await discoveryState(ctx);
    if (state?.phase !== 'verified') throw new CommerceError('TEMPORARILY_UNAVAILABLE');
    let search;
    try { search = discoverySearchQuery(args.query); } catch { throw new CommerceError('INVALID_INPUT'); }
    if (!search.text) throw new CommerceError('INVALID_INPUT');
    const options = catalogPageOptions({ numItems: 24, cursor: args.cursor }, 24, 1_000_000);
    const page = args.mode === 'native'
      ? await ctx.db.query('holmDiscoveryIndex').withSearchIndex('search_text', q => q.search('text', search.text).eq('version', HOLM_DISCOVERY_VERSION)).paginate(options)
      : await ctx.db.query('holmDiscoveryIndex').withIndex('by_name', q => q.eq('version', HOLM_DISCOVERY_VERSION)).paginate(options);
    return { version: HOLM_DISCOVERY_VERSION, generation: state.generation, ids: page.page.filter(row => args.mode === 'native' || matchesDiscoverySearch(search, row.text)).map(row => row.productId),
      cursor: page.isDone ? null : page.continueCursor };
  },
});
