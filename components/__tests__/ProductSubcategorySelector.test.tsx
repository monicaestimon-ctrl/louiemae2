import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CollectionConfig } from '../../types';
import { ProductSubcategorySelector } from '../ProductSubcategorySelector';

const kids: CollectionConfig = {
  id: 'kids', title: 'Kids', subtitle: '', heroImage: '',
  subcategories: [
    { id: 'girls', title: 'Girls', image: '', isMainCategory: true },
    { id: 'boys', title: 'Boys', image: '', isMainCategory: true },
    { id: 'girls-pants', title: 'Girls Pants', image: '', parentCategoryId: 'girls' },
    { id: 'boys-pants', title: 'Boys Pants', image: '', parentCategoryId: 'boys' },
  ],
};

const Harness = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string>();
  return (
    <>
      <ProductSubcategorySelector
        collection={kids}
        selectedIds={selectedIds}
        primaryId={primaryId}
        onChange={(ids, primary) => { setSelectedIds(ids); setPrimaryId(primary); }}
      />
      <output>{selectedIds.join(',')}|{primaryId}</output>
    </>
  );
};

describe('ProductSubcategorySelector', () => {
  it('allows separate Girls and Boys leaves and a selectable primary', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText('Girls Pants'));
    await user.click(screen.getByText('Boys Pants'));
    expect(screen.getByText('girls-pants,boys-pants|girls-pants')).toBeInTheDocument();

    const primaryChoices = screen.getAllByRole('radio');
    await user.click(primaryChoices[1]);
    expect(screen.getByText('girls-pants,boys-pants|boys-pants')).toBeInTheDocument();
  });

  it('does not offer parent categories as direct assignments', () => {
    render(<Harness />);
    expect(screen.queryByRole('checkbox', { name: 'Girls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Boys' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Girls Pants/ })).toBeInTheDocument();
  });
});
