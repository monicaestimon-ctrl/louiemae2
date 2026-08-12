import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const values = { ...process.env };

for (const filename of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  try {
    const content = await readFile(path.join(root, filename), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in values) continue;
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // Optional environment file.
  }
}

if (values.VITE_GEMINI_API_KEY) {
  console.error('VITE_GEMINI_API_KEY is forbidden because VITE_ variables are shipped to browsers.');
  process.exit(1);
}

const environment = values.VERCEL_ENV || values.NODE_ENV || 'development';
if (environment !== 'production') {
  const currentUrl = values.VITE_CONVEX_URL?.replace(/\/$/, '');
  const productionUrl = values.LOUIE_MAE_PRODUCTION_CONVEX_URL?.replace(/\/$/, '');
  const currentDeployment = values.CONVEX_DEPLOYMENT;
  const productionDeployment = values.LOUIE_MAE_PRODUCTION_CONVEX_DEPLOYMENT;
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
