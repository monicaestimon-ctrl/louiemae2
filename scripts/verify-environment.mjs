import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const environment = process.env.VERCEL_ENV
  || process.env.NODE_ENV
  || (process.env.npm_lifecycle_event === 'prebuild' ? 'production' : 'development');
const activeFileValues = {};

const parseEnvValue = (rawValue) => {
  const value = rawValue.trim();
  const quoted = value.match(/^(['"])([\s\S]*?)\1(?:\s*#.*)?$/);
  if (quoted) return quoted[2];
  // dotenv treats # as a comment delimiter for unquoted values. Quote values
  // that intentionally contain # so the character remains part of the value.
  return value.replace(/\s*#.*$/, '').trim();
};

const environmentFiles = [
  '.env',
  '.env.development',
  '.env.preview',
  '.env.production',
  '.env.local',
  '.env.development.local',
  '.env.preview.local',
  '.env.production.local',
];
const activeFiles = new Set([
  '.env',
  `.env.${environment}`,
  '.env.local',
  `.env.${environment}.local`,
]);

for (const filename of environmentFiles) {
  try {
    const content = await readFile(path.join(root, filename), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const value = parseEnvValue(match[2]);
      if (match[1] === 'VITE_GEMINI_API_KEY' && value) {
        console.error(`${filename}: VITE_GEMINI_API_KEY is forbidden because VITE_ variables are shipped to browsers.`);
        process.exit(1);
      }
      if (activeFiles.has(filename)) activeFileValues[match[1]] = value;
    }
  } catch {
    // Optional environment file.
  }
}

// Explicit process values supplied by Vercel or CI always win over files.
const values = { ...activeFileValues, ...process.env };

if (values.VITE_GEMINI_API_KEY) {
  console.error('VITE_GEMINI_API_KEY is forbidden because VITE_ variables are shipped to browsers.');
  process.exit(1);
}

if (environment !== 'production') {
  const currentUrl = values.VITE_CONVEX_URL?.replace(/\/$/, '');
  const productionUrl = values.LOUIE_MAE_PRODUCTION_CONVEX_URL?.replace(/\/$/, '');
  const currentDeployment = values.CONVEX_DEPLOYMENT;
  const productionDeployment = values.LOUIE_MAE_PRODUCTION_CONVEX_DEPLOYMENT;
  const missingComparisonVariables = [
    !productionUrl && 'LOUIE_MAE_PRODUCTION_CONVEX_URL',
    !productionDeployment && 'LOUIE_MAE_PRODUCTION_CONVEX_DEPLOYMENT',
  ].filter(Boolean);
  if (missingComparisonVariables.length > 0) {
    const verb = missingComparisonVariables.length === 1 ? 'is' : 'are';
    console.warn(
      `Environment guard warning: ${missingComparisonVariables.join(' and ')} ` +
      `${verb} absent; set ${missingComparisonVariables.length === 1 ? 'it' : 'them'} to verify Convex isolation.`,
    );
  }
  if (currentUrl && productionUrl && currentUrl === productionUrl) {
    console.error(`${environment} is configured to use the production Convex URL. Use a development or preview deployment.`);
    process.exit(1);
  }
  if (currentDeployment && productionDeployment && currentDeployment === productionDeployment) {
    console.error(`${environment} is configured to deploy to production Convex. Use a development or preview deployment.`);
    process.exit(1);
  }
}

console.log(`Environment guard passed for ${environment}.`);
