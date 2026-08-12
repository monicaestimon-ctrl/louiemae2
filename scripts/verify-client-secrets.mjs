import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceTargets = ['components', 'contexts', 'services', 'App.tsx', 'index.tsx', 'index.html', 'vite.config.ts'];
const sourceForbidden = [
  ['browser Gemini SDK import', /@google\/genai/],
  ['public Gemini environment variable', /VITE_GEMINI_API_KEY/],
  ['Gemini key injected through Vite define', /process\.env\.(?:GEMINI_API_KEY|API_KEY)/],
];
const bundleForbidden = [
  ['Google API key-shaped value', /AIza[0-9A-Za-z_-]{20,}/],
  ['legacy public Gemini variable', /VITE_GEMINI_API_KEY/],
];

async function filesAt(target) {
  const absolute = path.join(root, target);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return [];
  }
  if (info.isFile()) return [absolute];
  const files = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const child = path.join(absolute, entry.name);
    files.push(...(entry.isDirectory() ? await filesAt(path.relative(root, child)) : [child]));
  }
  return files;
}

async function scan(targets, rules) {
  const findings = [];
  for (const target of targets) {
    for (const filename of await filesAt(target)) {
      if (!/\.(?:[cm]?[jt]sx?|html)$/i.test(filename)) continue;
      const text = await readFile(filename, 'utf8');
      for (const [label, pattern] of rules) {
        if (pattern.test(text)) findings.push(`${path.relative(root, filename)}: ${label}`);
      }
    }
  }
  return findings;
}

const findings = [
  ...await scan(sourceTargets, sourceForbidden),
  ...await scan(['dist'], bundleForbidden),
];

if (findings.length > 0) {
  console.error('Client-secret verification failed:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('Client-secret verification passed.');
