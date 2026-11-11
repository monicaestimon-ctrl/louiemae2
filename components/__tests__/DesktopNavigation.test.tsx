import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopNavigation } from '../DesktopNavigation';
import type { NavLink } from '../../types';
const links: NavLink[] = [
  { label: 'Home', href: '#', children: [{ label: 'Our story', href: '#story' }] },
  {
    label: 'Furniture',
    href: '#collection/furniture',
    children: [{ label: 'Chairs', href: '#collection/furniture?cat=Chairs' }],
  },
];
afterEach(cleanup);
it('uses one named navigation and exposes keyboard disclosures independently of destination links', async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<DesktopNavigation links={links} scrolled={false} onNavigate={navigate} />);
  expect(screen.getAllByRole('navigation')).toHaveLength(1);
  expect(screen.queryByRole('link', { name: 'Our story' })).toBeNull();
  await user.tab();
  expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus();
  await user.tab();
  const toggle = screen.getByRole('button', { name: 'Home sections' });
  expect(toggle).toHaveFocus();
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.tab();
  expect(screen.getByRole('link', { name: 'Our story' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('link', { name: 'Our story' })).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});
it('closes on outside focus and pointer interaction, preserves modified links and navigates plain clicks', async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(
    <>
      <DesktopNavigation links={links} scrolled onNavigate={navigate} />
      <button>Outside</button>
    </>
  );
  const toggle = screen.getByRole('button', { name: 'Furniture sections' });
  await user.click(toggle);
  const chairs = screen.getByRole('link', { name: 'Chairs' });
  fireEvent.click(chairs, { ctrlKey: true });
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(chairs);
  expect(navigate).toHaveBeenCalledWith('#collection/furniture?cat=Chairs');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  await user.click(screen.getByRole('button', { name: 'Outside' }));
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  fireEvent.pointerDown(document.body);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
