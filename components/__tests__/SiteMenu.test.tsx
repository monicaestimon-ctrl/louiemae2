import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SiteMenu } from '../SiteMenu';
import { NavLink } from '../../types';

const links: NavLink[] = [
  { label: 'Home', href: '#', children: [{ label: 'Our Story', href: '#story' }] },
  {
    label: 'Kids', href: '#collection/kids', children: [
      { label: 'Shop All', href: '#collection/kids' },
      { label: 'Girls', href: '#collection/kids?cat=Girls', children: [
        { label: 'Dresses', href: '#collection/kids?cat=Girls Dresses' },
      ] },
    ],
  },
  { label: 'Journal', href: '#blog' },
];

const setup = (open = true) => {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  const view = render(<SiteMenu open={open} links={links} onNavigate={onNavigate} onClose={onClose} />);
  const nav = () => within(screen.getByRole('navigation'));
  return { onNavigate, onClose, view, nav };
};

it('shows only the top level, and steps into one section at a time', () => {
  const { nav, onNavigate } = setup();
  expect(nav().getAllByRole('button').map(b => b.textContent)).toEqual(['Home', 'Kids', 'Journal']);
  expect(screen.queryByText('Dresses')).not.toBeInTheDocument();

  fireEvent.click(nav().getByRole('button', { name: 'Kids' }));
  // The section already lists its own "Shop All", so no extra overview row is added.
  expect(nav().getAllByRole('button').map(b => b.textContent)).toEqual(['Shop All', 'Girls']);
  expect(screen.queryByText('Dresses')).not.toBeInTheDocument();

  fireEvent.click(nav().getByRole('button', { name: 'Girls' }));
  expect(nav().getAllByRole('button').map(b => b.textContent)).toEqual(['Shop all Girls', 'Dresses']);
  fireEvent.click(nav().getByRole('button', { name: 'Dresses' }));
  expect(onNavigate).toHaveBeenCalledWith('#collection/kids?cat=Girls Dresses');

  fireEvent.click(screen.getByRole('button', { name: 'Kids' })); // back link names the parent
  expect(nav().getByRole('button', { name: 'Girls' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  expect(nav().getByRole('button', { name: 'Journal' })).toBeInTheDocument();
});

it('goes straight to pages without sub-sections and skips overview rows for placeholder links', () => {
  const { nav, onNavigate } = setup();
  fireEvent.click(nav().getByRole('button', { name: 'Journal' }));
  expect(onNavigate).toHaveBeenCalledWith('#blog');
  fireEvent.click(nav().getByRole('button', { name: 'Home' }));
  expect(nav().getAllByRole('button').map(b => b.textContent)).toEqual(['Our Story']);
});

it('Escape steps back a level, then closes; reopening starts at the top', () => {
  const { nav, onClose, view } = setup();
  fireEvent.click(nav().getByRole('button', { name: 'Kids' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(nav().getByRole('button', { name: 'Journal' })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);

  fireEvent.click(nav().getByRole('button', { name: 'Kids' }));
  view.rerender(<SiteMenu open={false} links={links} onNavigate={vi.fn()} onClose={onClose} />);
  view.rerender(<SiteMenu open links={links} onNavigate={vi.fn()} onClose={onClose} />);
  expect(nav().getByRole('button', { name: 'Journal' })).toBeInTheDocument();
});
