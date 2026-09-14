export function prelaunchEntry(pathname: string, hash: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin') return 'admin';
  if (path === '/waitlist-admin') return 'waitlist-admin';
  if (hash.split('?')[0] === '#admin') return 'legacy-admin';
  return 'landing';
}
