import { readdir } from 'node:fs/promises';
const paths = await readdir('api', { recursive: true });
const accidental = paths.filter(p => /(^|[/\\])(tests?|__tests__|__mocks__|__fixtures__|fixtures?|mocks?)([/\\]|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(p));
if (accidental.length) throw new Error(`Test-only files must not become API routes: ${accidental.join(', ')}`);
console.log('API route source boundary verified.');
