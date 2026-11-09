// Fails if any non-test Convex file patches, replaces or deletes a row in an append-only table
// (ledger events, audit events, source observations). Corrections must be new events.
import fs from 'node:fs';
import path from 'node:path';

const APPEND_ONLY = ['ldgCommissionEvents', 'ldgCreditEvents', 'sysAuditEvents', 'catSourceObservations', 'catStockRevisions', 'dlvFreightInvoices', 'dlvTaxAdjustments', 'dlvActualCostStatements', 'dlvLegacyFreightReviews', 'ordFreightActuals'];
const files = fs.readdirSync('convex', { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.') && !f.startsWith('_generated'));
const problems = [];
for (const f of files) {
  const src = fs.readFileSync(path.join('convex', f), 'utf8');
  // An id typed for an append-only table, then written with patch/replace/delete.
  for (const table of APPEND_ONLY) {
    const re = new RegExp(`db\\.(patch|replace|delete)\\([^)]*${table}`, 'g');
    if (re.test(src)) problems.push(`${f}: writes ${table} in place`);
  }
  // Ids loaded from an append-only table and written later in the same file.
  for (const table of APPEND_ONLY) {
    const vars = [...src.matchAll(new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*await\\s+ctx\\.db\\.query\\('${table}'\\)`, 'g'))].map((m) => m[1]);
    for (const name of vars) if (new RegExp(`db\\.(patch|replace|delete)\\(\\s*${name}\\b`).test(src)) problems.push(`${f}: modifies ${table} row ${name}`);
  }
}
if (problems.length) {
  console.error('Append-only tables were modified:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Append-only check passed for ${files.length} Convex files.`);
