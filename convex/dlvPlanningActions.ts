'use node';
import { action, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { planningArgs } from './dlvPlanning';
import { proofArg } from './dlvPerimeter';
import { v } from 'convex/values';
import { fedexRate } from '../lib/delivery/fedex';
import { planningDelivery, PLANNING_NOTE } from '../lib/delivery/planning';
import { CommerceError } from '../lib/errors';
import { customerFacing } from '../lib/delivery/publicErrors';
import type { FunctionArgs } from 'convex/server';

type Input = FunctionArgs<typeof internal.dlvPlanning.prepare>;
type PlanningEstimate = {
  status: 'ok' | 'quote_required'; payable: false; deliveryChargeMinor: number | null;
  serviceName: string; serviceDetails: string[]; timingCaveat: string; expiresAt: number;
};
async function calculate(ctx: ActionCtx, input: Input): Promise<PlanningEstimate> {
  const unavailable: PlanningEstimate = { status: 'quote_required', payable: false, deliveryChargeMinor: null,
    serviceName: 'Estimated parcel delivery', serviceDetails: [PLANNING_NOTE], timingCaveat: 'Availability and delivery timing require confirmation.', expiresAt: Date.now() };
  const work = await ctx.runQuery(internal.dlvPlanning.prepare, input);
  if (!work) return unavailable;
  const rate = await fedexRate(work.shipment, { key: process.env.FEDEX_API_KEY ?? '', secret: process.env.FEDEX_SECRET_KEY ?? '', account: process.env.FEDEX_ACCOUNT_NUMBER ?? '' });
  if (rate.ok !== true || work.expiresAt <= Date.now()) return unavailable;
  const deliveryChargeMinor = planningDelivery({ ...work.calculation, freightMinor: rate.freightMinor });
  // Deliberately no estimateId, checkout capability, tax, total, reservation or purchasability mutation.
  return deliveryChargeMinor === null ? unavailable : { ...unavailable, status: 'ok', deliveryChargeMinor, expiresAt: work.expiresAt };
}

export const estimate = action({
  args: { ...planningArgs, proof: v.optional(proofArg) },
  handler: async (ctx, a): Promise<PlanningEstimate> => customerFacing(async () => {
    const { proof, ...input } = a;
    const permit = await ctx.runMutation(internal.dlvPerimeter.consume, { operation: 'planning', input, ...(proof ? { proof } : {}) });
    if (permit !== 'ok') throw new CommerceError(permit === 'limited' ? 'RATE_LIMITED' : 'FORBIDDEN');
    return calculate(ctx, input);
  }),
});

/** Authenticated staff can assess unpublished imported products without publishing or clearing holds. */
export const preview = action({
  args: planningArgs,
  handler: async (ctx, a): Promise<PlanningEstimate> => customerFacing(() => calculate(ctx, { ...a, staff: true })),
});
