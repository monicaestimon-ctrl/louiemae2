/** A cached lazy-import rejection requires a document reload, not a subtree remount. */
export class ModuleLoadError extends Error {
  constructor(cause?: unknown) { super('This screen could not be loaded.', { cause }); this.name = 'ModuleLoadError'; }
}

/** Bound module loading without automatic reload loops or suppressing the original failure. */
export function loadModule<T>(load: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ModuleLoadError()), 10_000);
    Promise.resolve().then(load).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(new ModuleLoadError(error)); });
  });
}

/** Offer recovery even when the application module never mounted React. */
export function showStartupFailure(error: unknown) {
  console.error('Storefront startup failed', error);
  document.getElementById('lm-shell')?.remove();
  document.getElementById('holm-shell')?.remove();
  const root = document.getElementById('root');
  if (!root) return;
  const main = document.createElement('main');
  main.setAttribute('aria-labelledby', 'startup-error-heading');
  Object.assign(main.style, { minHeight: '100svh', display: 'grid', alignContent: 'center', justifyItems: 'center', padding: '24px', gap: '20px', color: '#302419', background: '#faf7f0', textAlign: 'center' });
  const heading = document.createElement('h1'); heading.id = 'startup-error-heading'; heading.textContent = 'This page could not be loaded';
  const message = document.createElement('p'); message.textContent = 'Please reload the page to try again. Your saved cart has not been cleared.';
  const retry = document.createElement('button'); retry.textContent = 'Reload page'; retry.type = 'button'; retry.onclick = () => window.location.reload();
  Object.assign(retry.style, { minHeight: '44px', padding: '12px 24px', border: '1px solid currentColor', borderRadius: '4px' });
  const support = document.createElement('a'); support.href = '/#support'; support.textContent = 'Contact support'; support.style.textDecoration = 'underline';
  main.append(heading, message, retry, support); root.replaceChildren(main);
}
