// Run from the repo root. Dry-run unless --apply; credentials and receipts stay outside Git.
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { ConvexHttpClient } from 'convex/browser';

const [secretFile, receiptFile, mode] = process.argv.slice(2);
if (!secretFile || !receiptFile || (mode && mode !== '--apply'))
  throw new Error('Usage: node scripts/v2/activate-ashcroft-expenses.mjs <admin-secret-file> <private-receipt-file> [--apply]');
if (path.resolve(secretFile) === path.resolve(receiptFile)) throw new Error('Receipt must not overwrite credentials');
// Exclusive creation rejects existing files, including links to a credential file.
const receiptFd = fs.openSync(receiptFile, 'wx', 0o600);
try {
const compiled = await build({ entryPoints: ['lib/config/index.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { parseConfig } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const client = new ConvexHttpClient('https://diligent-jay-261.convex.cloud');
const login = await client.action('auth:signIn', { provider: 'password', params: {
  email: 'admin@louiemae.com', password: fs.readFileSync(secretFile, 'utf8').trimEnd(), flow: 'signIn',
} });
client.setAuth(login.tokens.token);
const records = (await client.query('sysConfig:list', {})).records;
const now = Date.now();
const active = (kind, key) => records.filter(r => r.kind === kind && r.key === key && r.status === 'approved'
  && r.effectiveFrom <= now && (r.effectiveTo === undefined || r.effectiveTo > now)).sort((a, b) => b.version - a.version)[0];
const shared = active('pricingAssumptions', 'zuo-pricing-assumptions');
if (!shared) throw new Error('Approved common expense model missing');
const value = {
  supplierCode: 'ashcroft', wholesaleUnitBasis: 'selling_unit',
  supplierPaymentReserveBps: shared.value.supplierPaymentReserveBps,
  processingBps: shared.value.processingBps, returnsBps: shared.value.returnsBps, overheadBps: shared.value.overheadBps,
  handlingPerSellingUnitMinor: shared.value.handlingPerPieceMinor,
  fixedProcessingPerSellingUnitMinor: 30, fundedTradeDiscountBps: 0,
};
parseConfig('pricingAssumptions', value);
const key = 'ashcroft-pricing-assumptions';
const existing = records.filter(r => r.kind === 'pricingAssumptions' && r.key === key);
if (existing.length) throw new Error('Ashcroft configuration already exists; review it rather than replacing it');
const note = 'Owner direction 2026-11-27: apply common approved allowances, buffers and overhead to both suppliers separately. Ashcroft allocation is per selling unit (a set is one unit): common handling amount plus conservative $0.30 fixed processing allocation per unit. No promised universal trade reduction. Ashcroft category freight remains in its existing delivery engine; no Zuo size allowance or drop-ship fee is copied. This is an internal expense model, not supplier confirmation of unknown charges. No prices or publication enabled.';
const receipt = { at: new Date().toISOString(), apply: mode === '--apply', sourceConfigId: shared._id,
  sourceConfigVersion: shared.version, key, value, note, status: 'validated' };
const save = () => {
  const data = JSON.stringify(receipt, null, 2);
  fs.writeSync(receiptFd, data, 0, 'utf8');
  fs.ftruncateSync(receiptFd, Buffer.byteLength(data));
  fs.fsyncSync(receiptFd);
};
save();
if (mode === '--apply') {
  receipt.proposalId = await client.mutation('sysConfig:propose', { kind: 'pricingAssumptions', key, value, note });
  receipt.status = 'proposed'; save();
  await client.mutation('sysConfig:approve', { id: receipt.proposalId, note });
  receipt.readback = (await client.query('sysConfig:list', {})).records.find(r => r._id === receipt.proposalId);
  if (receipt.readback?.status !== 'approved') throw new Error('Approval readback failed');
  receipt.status = 'approved'; save();
}
console.log(JSON.stringify({ status: receipt.status, key, value }));
} finally {
  fs.closeSync(receiptFd);
}
