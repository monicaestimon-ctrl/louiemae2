import { v } from 'convex/values';
import { internalMutation } from './functions';
import { lineArg, addressArg } from './dlvEstimates';
import { computeEstimate, type FedexWork, type FreightConfig } from './dlvEngine';
import { activeConfig, maybeConfig } from './sysConfig';
import { requireFlag } from '../lib/flags';
import { assertDeliveryBounds } from '../lib/delivery/requestBounds';
import { CommerceError } from '../lib/errors';

/** Called only after the public gateway's signature and rate limit have passed. */
export const prepare = internalMutation({
  args: { lines: v.array(lineArg), channel: v.union(v.literal('retail'), v.literal('trade')),
    zip: v.string(), address: v.optional(addressArg), service: v.optional(v.string()) },
  handler: async (ctx, a): Promise<FedexWork[]> => {
    if (process.env.FEDEX_RATES_ENABLED !== 'true') return [];
    requireFlag('DELIVERY_AUTOMATION_ENABLED');
    assertDeliveryBounds(a, 30);
    const config = await maybeConfig<FreightConfig>(ctx, 'carrierRule', 'zuo-freight');
    if (config?.value.rateBasis !== 'live_fedex') return [];
    const work: FedexWork[] = [];
    await computeEstimate(ctx, { lines: a.lines, channel: a.channel,
      destination: { zip: a.zip.trim(), ...(a.address ? { address: a.address } : {}) },
      service: a.service ?? 'curbside' }, Date.now(), work);
    return work;
  },
});

/** No public writer or client-supplied rate. Account/carton/address/policy changes use a new key. */
export const record = internalMutation({
  args: { key: v.string(), configVersion: v.number(), freightMinor: v.number(), service: v.string(),
    rateType: v.union(v.literal('ACCOUNT'), v.literal('LIST')), transactionId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const config = await activeConfig<FreightConfig>(ctx, 'carrierRule', 'zuo-freight');
    if (process.env.FEDEX_RATES_ENABLED !== 'true' || config.version !== a.configVersion ||
      config.value.rateBasis !== 'live_fedex' || !config.value.fedex ||
      config.value.fedex.rateType !== a.rateType || !/^[a-f0-9]{64}$/.test(a.key) ||
      !['GROUND_HOME_DELIVERY', 'FEDEX_GROUND'].includes(a.service) ||
      !Number.isSafeInteger(a.freightMinor) || a.freightMinor <= 0 || a.freightMinor > 100_000_000)
      throw new CommerceError('QUOTE_EXPIRED');
    const now = Date.now();
    const existing = await ctx.db.query('dlvCarrierRates').withIndex('by_key', q => q.eq('key', a.key)).unique();
    // Keep a concurrent valid result stable for estimates already using it.
    if (existing && existing.expiresAt > now) return;
    const row = { ...a, createdAt: now, expiresAt: Math.min(now + config.value.fedex.validityMinutes * 60000,
      config.effectiveTo ?? Infinity, config.value.validUntil ?? Infinity, config.value.rule.effectiveTo ?? Infinity) };
    if (row.expiresAt <= now) throw new CommerceError('QUOTE_EXPIRED');
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert('dlvCarrierRates', row);
    const expired = await ctx.db.query('dlvCarrierRates').withIndex('by_expiry', q => q.lt('expiresAt', now - 86400000)).take(50);
    for (const old of expired) await ctx.db.delete(old._id);
  },
});
