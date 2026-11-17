import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { install, Browser, BrowserPlatform } from '@puppeteer/browsers';

const profile = JSON.parse(await readFile(new URL('./controlled-profile.json', import.meta.url), 'utf8'));
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Controlled runner requires Linux x64');
if (process.versions.node !== profile.node) throw new Error('Controlled runner Node version mismatch');
if (!process.env.GITHUB_ENV) throw new Error('This installer requires the GitHub Actions environment');
const browser = await install({ browser: Browser.CHROME, platform: BrowserPlatform.LINUX,
  buildId: profile.chrome, cacheDir: resolve('tmp/audit-browser') });
await appendFile(process.env.GITHUB_ENV, `CHROME_PATH=${browser.executablePath}\nAUDIT_CHROME_VERSION=${profile.chrome}\n`);
