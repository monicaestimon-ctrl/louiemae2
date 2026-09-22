import { v } from 'convex/values';
import { query, mutation, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { furnitureFields } from './furnitureTables';
import { estimate, publicFurniture, validateFurniture } from '../lib/furniture';

export const catalog = query({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query('furnitureProducts')
        .withIndex('by_published', (q) => q.eq('published', true))
        .take(500)
    ).map(publicFurniture),
});
export const access = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCjAdminIdentity(ctx);
      return true;
    } catch {
      return false;
    }
  },
});
export const adminProducts = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db.query('furnitureProducts').order('desc').take(500);
  },
});
export const requests = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db.query('furnitureQuotes').order('desc').take(200);
  },
});
export const save = mutation({
  args: { id: v.optional(v.id('furnitureProducts')), product: v.object(furnitureFields) },
  handler: async (ctx, { id, product }) => {
    await requireCjAdminIdentity(ctx);
    validateFurniture(product);
    if (JSON.stringify(product).length > 100000) throw new Error('Product details are too large.');
    if (id && !(await ctx.db.get(id))) throw new Error('Product no longer exists.');
    let supplierId;
    if (product.supplierName.trim()) {
      const key =
        product.supplierKey.trim() || `manual:${product.supplierName.trim().toLowerCase()}`;
      const existing = await ctx.db
        .query('furnitureSuppliers')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique();
      const details = {
        key,
        name: product.supplierName.trim(),
        contact: product.supplierContact.trim(),
        updatedAt: Date.now(),
      };
      if (existing) {
        supplierId = existing._id;
        await ctx.db.patch(existing._id, details);
      } else supplierId = await ctx.db.insert('furnitureSuppliers', details);
    }
    if (!id && product.sourceUrl) {
      const duplicate = await ctx.db
        .query('furnitureProducts')
        .withIndex('by_source', (q) => q.eq('sourceUrl', product.sourceUrl))
        .first();
      if (duplicate)
        throw new Error(
          'This source is already in the furniture catalog. Edit the existing draft.'
        );
    }
    const data = { ...product, supplierId, updatedAt: Date.now() };
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return ctx.db.insert('furnitureProducts', { ...data, importedAt: Date.now() });
  },
});
export const setStatus = mutation({
  args: {
    id: v.id('furnitureQuotes'),
    status: v.union(
      v.literal('new'),
      v.literal('reviewing'),
      v.literal('quoted'),
      v.literal('closed')
    ),
  },
  handler: async (ctx, { id, status }) => {
    await requireCjAdminIdentity(ctx);
    await ctx.db.patch(id, { status });
  },
});
export const submit = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    email: v.string(),
    business: v.string(),
    address: v.string(),
    phone: v.string(),
    notes: v.string(),
    service: v.string(),
    website: v.string(),
    items: v.array(
      v.object({
        productId: v.id('furnitureProducts'),
        variantId: v.string(),
        quantity: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    if (args.website || !/^[\w-]{20,80}$/.test(args.token))
      throw new Error('Please refresh and try again.');
    const email = args.email.trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !args.name.trim() ||
      args.name.length > 150 ||
      args.address.trim().length < 10 ||
      args.address.length > 1000 ||
      args.notes.length > 3000 ||
      args.business.length > 200 ||
      args.phone.length > 50 ||
      args.service.length > 100
    )
      throw new Error('Please check your contact and delivery details.');
    const existing = await ctx.db
      .query('furnitureQuotes')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    if (existing) {
      if (existing.email !== email) throw new Error('Please refresh and try again.');
      return existing._id;
    }
    const recent = await ctx.db
      .query('furnitureQuotes')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .take(3);
    if (recent.length === 3 && recent[2].createdAt > Date.now() - 3600000)
      throw new Error(
        'You have sent several requests. Please wait an hour before sending another.'
      );
    if (!args.items.length || args.items.length > 50)
      throw new Error('Select 1–50 furniture options.');
    const seen = new Set<string>();
    const items = await Promise.all(
      args.items.map(async (item) => {
        const key = `${item.productId}:${item.variantId}`;
        if (seen.has(key)) throw new Error('Combine duplicate options before submitting.');
        seen.add(key);
        const product = await ctx.db.get(item.productId);
        const variant = product?.variants.find((v) => v.id === item.variantId);
        if (!product?.published || !variant)
          throw new Error('An item is no longer available. Please refresh your selection.');
        if (
          !Number.isInteger(item.quantity) ||
          item.quantity < variant.minimum ||
          item.quantity > 9999
        )
          throw new Error(`Check the quantity for ${product.name}.`);
        return {
          ...item,
          name: product.name,
          variant: variant.name,
          ...estimate(variant.cost, product.usdRate),
        };
      })
    );
    const id = await ctx.db.insert('furnitureQuotes', {
      token: args.token,
      name: args.name.trim(),
      email,
      business: args.business,
      address: args.address.trim(),
      phone: args.phone,
      notes: args.notes,
      service: args.service,
      items,
      lower: items.reduce((sum, i) => sum + i.lower * i.quantity, 0),
      upper: items.reduce((sum, i) => sum + i.upper * i.quantity, 0),
      status: 'new',
      createdAt: Date.now(),
      customerEmailStatus: 'pending',
      ownerEmailStatus: 'pending',
    });
    await ctx.scheduler.runAfter(0, internal.furnitureEmail.deliver, {
      id,
      audience: 'customer',
      attempt: 0,
    });
    await ctx.scheduler.runAfter(0, internal.furnitureEmail.deliver, {
      id,
      audience: 'owner',
      attempt: 0,
    });
    return id;
  },
});
export const emailRecord = internalQuery({
  args: { id: v.id('furnitureQuotes') },
  handler: (ctx, { id }) => ctx.db.get(id),
});
export const emailStatus = internalMutation({
  args: { id: v.id('furnitureQuotes'), audience: v.string(), status: v.string() },
  handler: (ctx, { id, audience, status }) =>
    ctx.db.patch(
      id,
      audience === 'customer' ? { customerEmailStatus: status } : { ownerEmailStatus: status }
    ),
});
export const retryEmail = mutation({
  args: {
    id: v.id('furnitureQuotes'),
    audience: v.union(v.literal('customer'), v.literal('owner')),
  },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error('Request not found.');
    const status =
      args.audience === 'customer' ? record.customerEmailStatus : record.ownerEmailStatus;
    if (status === 'sent' || status === 'pending' || status === 'retrying') return;
    await ctx.db.patch(
      args.id,
      args.audience === 'customer'
        ? { customerEmailStatus: 'pending' }
        : { ownerEmailStatus: 'pending' }
    );
    await ctx.scheduler.runAfter(0, internal.furnitureEmail.deliver, { ...args, attempt: 0 });
  },
});
