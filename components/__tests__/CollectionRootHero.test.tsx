import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CollectionRootHero } from '../CollectionRootHero';
afterEach(cleanup);
it('provides native category destinations and rejects unsafe redirects or images', () => {
  const {container} = render(<CollectionRootHero collection="decor" title="Home Decor" subtitle="Objects" categories={[
    {id:'chairs',title:'Chairs',image:'/images/brand/DINNERTABLE.png',redirect:'#collection/furniture?cat=chairs'},
    {id:'lamps',title:'Lamps',image:'javascript:bad()',redirect:'javascript:bad()'},
  ]}/>);
  expect(screen.getAllByRole('link',{name:/Chairs/}).every(link=>link.getAttribute('href')==='/collection/furniture?cat=chairs')).toBe(true);
  expect(screen.getAllByRole('link',{name:/Lamps/}).every(link=>link.getAttribute('href')==='/collection/decor?cat=lamps')).toBe(true);
  expect(container.innerHTML).not.toContain('javascript:');
  expect(container.querySelectorAll('h1')).toHaveLength(1);
  expect([...container.querySelectorAll('img')].every(image=>image.alt==='' && image.style.opacity!=='0')).toBe(true);
});
it('encodes category identities in genuine URLs without requiring a click handler', () => {
  render(<CollectionRootHero collection="kids" title="Kids" subtitle="Clothing" categories={[{id:'girls & boys',title:'Shared',image:''}]}/>);
  expect(screen.getAllByRole('link').every(link=>link.getAttribute('href')==='/collection/kids?cat=girls%20%26%20boys')).toBe(true);
});
