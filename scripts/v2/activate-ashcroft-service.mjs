// Dry-run by default. Use a fresh private receipt path for every invocation.
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { ConvexHttpClient } from 'convex/browser';

const [secretFile, receiptFile, mode] = process.argv.slice(2);
if (!secretFile || !receiptFile || process.argv.length > 5 || (mode && mode !== '--apply'))
  throw new Error('Usage: node scripts/v2/activate-ashcroft-service.mjs <admin-secret-file> <private-receipt-file> [--apply]');
const fd = fs.openSync(receiptFile, 'wx', 0o600);
try {
  const compiled = await build({ entryPoints: ['lib/config/index.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  const { parseConfig } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const client = new ConvexHttpClient('https://diligent-jay-261.convex.cloud');
  const login = await client.action('auth:signIn', { provider: 'password', params: {
    email: 'admin@louiemae.com', password: fs.readFileSync(secretFile, 'utf8').trimEnd(), flow: 'signIn',
  } });
  client.setAuth(login.tokens.token);
  const permissions = await client.query('dlvAccess:permissions', {});
  if (!permissions.approver) throw new Error('An approver is required before proposing service configuration');
  const kind = 'serviceLevel', key = 'delivery-curbside';
  const read = async () => (await client.query('sysConfig:list', {})).records
    .filter(r => r.kind === kind && r.key === key).sort((a, b) => b.version - a.version);
  const records = await read();
  const now = Date.now();
  const source = records.find(r => r.status === 'approved' && r.effectiveFrom <= now
    && (r.effectiveTo === undefined || r.effectiveTo > now));
  if (!source || source.value.code !== 'curbside' || !source.value.modes.ground || !source.value.modes.ltl)
    throw new Error('Expected approved delivery service configuration missing');
  if (records[0]._id !== source._id || source.value.modes.per_item)
    throw new Error('Newer configuration or per-item mode already exists; review before replacing');
  const value = globalThis.structuredClone(source.value);
  value.modes.per_item = {
    label: 'Economy delivery',
    details: [
      'Economy-delivered items are estimated to arrive 5–8 business days after the order is placed with the supplier; timing is not guaranteed.',
      'Inside delivery, stairs, assembly and liftgate service are not promised for Economy-delivered items.',
    ],
    evidenceRef: 'Ashcroft authenticated dealer checkout samples 2026-10-19; docs/ashcroft-retail-shipping-review.md. Owner-approved working estimates, not nationwide service certification.',
  };
  parseConfig(kind, value);
  const note = 'Complete owner-authorized Ashcroft checkout configuration using observed Economy service. Preserve existing Zuo ground and LTL terms exactly. This adds descriptive terms only; no destination coverage, prices, inventory or sale qualification is granted. Existing estimates must refresh against the new configuration version.';
  const receipt = { at: new Date().toISOString(), apply: mode === '--apply', kind, key,
    deployment: 'https://diligent-jay-261.convex.cloud', actor: 'admin@louiemae.com',
    sourceId: source._id, sourceVersion: source.version, before: source.value, value, note, status: 'validated' };
  const save = () => {
    const data = JSON.stringify(receipt, null, 2);
    fs.writeSync(fd, data, 0, 'utf8'); fs.ftruncateSync(fd, Buffer.byteLength(data)); fs.fsyncSync(fd);
  };
  save();
  if (mode === '--apply') {
    if ((await read())[0]?._id !== source._id) throw new Error('Service configuration changed; rerun review');
    receipt.proposalId = await client.mutation('sysConfig:propose', { kind, key, value, note,
      ...(source.decision ? { decision: source.decision } : {}) });
    receipt.status = 'proposed'; save();
    const proposed = (await read())[0];
    if (proposed?._id !== receipt.proposalId || proposed.version !== source.version + 1)
      throw new Error('Concurrent service proposal; approval withheld');
    await client.mutation('sysConfig:approve', { id: receipt.proposalId, note });
    const latest = (await read())[0];
    if (latest?._id !== receipt.proposalId || latest.status !== 'approved') throw new Error('Active approval readback failed');
    receipt.readback = latest; receipt.status = 'approved'; save();
  }
  console.log(JSON.stringify({ status: receipt.status, kind, key, sourceVersion: source.version, addedMode: 'per_item' }));
} finally {
  fs.closeSync(fd);
}
