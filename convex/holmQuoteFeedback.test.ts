// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import schema from './schema';
import { customerMessage, isCommerceError } from '../lib/errors';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const request = {
  token: 'quote-feedback-fixture-token', projectName: 'Fixture', name: 'Fixture Buyer',
  email: 'fixture@example.com', phone: '', business: '',
  address: { line1: '1 Main', city: 'Stockton', state: 'CA', postalCode: '95206', country: 'US' },
  timing: 'asap' as const, date: '', receiving: 'threshold' as const, notes: '', website: '', items: [],
};

describe('quote guard customer feedback', () => {
  it.each([
    [{ notes: 'x'.repeat(3001) }, 'Check your contact and delivery details.'],
    [{ address: { ...request.address, line1: '' } }, 'Add the delivery address.'],
  ])('returns actionable validation without creating a project', async (patch, message) => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.holm.requestQuote, { ...request, ...patch })).rejects.toSatisfy(
      (error: unknown) => isCommerceError(error, 'INVALID_INPUT') && customerMessage(error) === message,
    );
    expect(await t.run(ctx => ctx.db.query('commerceProjects').collect())).toHaveLength(0);
  });

  it('explains the hourly limit without creating a fourth project', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let index = 0; index < 3; index++) await ctx.db.insert('commerceProjects', {
        token: `prior-fixture-${index}`, channel: 'house', name: request.name, email: request.email,
        phone: '', business: '', address: request.address, notes: '', requested: [], lines: [],
        delivery: 0, tax: 0, revision: 1, status: 'requested', createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    await expect(t.mutation(api.holm.requestQuote, request)).rejects.toSatisfy(
      (error: unknown) => isCommerceError(error, 'RATE_LIMITED') && customerMessage(error) ===
        'You have sent several requests. Please wait an hour before sending another.',
    );
    expect(await t.run(ctx => ctx.db.query('commerceProjects').collect())).toHaveLength(3);
  });
});
