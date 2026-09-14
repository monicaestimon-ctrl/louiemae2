import { expect, it } from 'vitest';
import { prelaunchEntry } from './routes';
it('keeps every public shopping entry on the prelaunch page', () => {
  for (const [path,hash] of [['/',''],['/shop',''],['/','#collection/furniture'],['/checkout',''],['/products/chair','']]) expect(prelaunchEntry(path,hash)).toBe('landing');
});
it('redirects legacy administrator links instead of mounting the store at the public root', () => {
  expect(prelaunchEntry('/','#admin')).toBe('legacy-admin');
  expect(prelaunchEntry('/','#admin?tab=products')).toBe('legacy-admin');
  expect(prelaunchEntry('/admin/','')).toBe('admin');
  expect(prelaunchEntry('/waitlist-admin','')).toBe('waitlist-admin');
});
