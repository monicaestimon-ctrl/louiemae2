// Stable product slugs (spec S14, v2 §5): short and readable, with history so a renamed product
// keeps its old links working.
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** A free slug: the base, or the base with -2, -3 … when taken. */
export function uniqueSlug(name: string, taken: (slug: string) => boolean): string {
  const base = slugify(name) || 'product';
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
  throw new Error('No free slug');
}

/** Short Louie Mae name check: present, not too long, no supplier-exclusive claims. */
export function nameProblems(name: string): string[] {
  const out: string[] = [];
  const n = name.trim();
  if (n.length < 3) out.push('Name is too short');
  if (n.length > 60) out.push('Name is too long (60 characters at most)');
  if (/\b(exclusive(ly)?|designed by louie mae|made by louie mae|louie mae original)\b/i.test(n)) out.push('Name implies exclusive design or manufacture');
  return out;
}
