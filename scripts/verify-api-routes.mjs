import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
const paths = await readdir('api', { recursive: true });
const accidental = paths.filter(p => /(^|[/\\])(tests?|__tests__|__mocks__|__fixtures__|fixtures?|mocks?)([/\\]|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(p));
if (accidental.length) throw new Error(`Test-only files must not become API routes: ${accidental.join(', ')}`);
console.log('API route source boundary verified.');

// Vercel's Node trace resolves .js imports to .ts, but does not reliably package
// a .tsx sibling. An explicit local compile list must not hide that deployment gap.
const graph = await build({entryPoints: paths.filter(p => /\.[cm]?[jt]s$/.test(p)).map(p => 'api/' + p.replaceAll('\\','/')),
  bundle:true,packages:'external',platform:'node',format:'esm',write:false,metafile:true,outdir:'artifacts/api-boundary'});
const jsxSources=Object.keys(graph.metafile.inputs).filter(p => /\.[jt]sx$/.test(p));
if(jsxSources.length)throw new Error('Node API graph must use traceable .ts/.js sources, not JSX source files: '+jsxSources.join(', '));
console.log('Node API dependency graph contains no untraceable JSX sources.');
