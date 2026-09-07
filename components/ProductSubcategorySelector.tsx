import React from 'react';
import { Check } from 'lucide-react';
import type { CollectionConfig } from '../types';
import { MAX_PRODUCT_SUBCATEGORIES, getCategoryParentId } from '../lib/productCategories';

interface ProductSubcategorySelectorProps {
  collection?: CollectionConfig;
  selectedIds: string[];
  primaryId?: string;
  onChange: (selectedIds: string[], primaryId?: string) => void;
  disabled?: boolean;
  compact?: boolean;
  dark?: boolean;
}

export const ProductSubcategorySelector: React.FC<ProductSubcategorySelectorProps> = ({
  collection,
  selectedIds,
  primaryId,
  onChange,
  disabled = false,
  compact = false,
  dark = false,
}) => {
  if (!collection) {
    return <p className={`text-xs ${dark ? 'text-cream/60' : 'text-earth/60'}`}>Choose a collection first.</p>;
  }
  const parentIds = new Set(collection.subcategories.map((category) => getCategoryParentId(category, collection)).filter(Boolean));
  const leaves = collection.subcategories.filter((category) => !parentIds.has(category.id));
  const effectivePrimary = primaryId && selectedIds.includes(primaryId) ? primaryId : selectedIds[0];

  const toggle = (id: string) => {
    if (disabled) return;
    if (selectedIds.includes(id)) {
      const next = selectedIds.filter((selectedId) => selectedId !== id);
      onChange(next, effectivePrimary === id ? next[0] : effectivePrimary);
      return;
    }
    if (selectedIds.length >= MAX_PRODUCT_SUBCATEGORIES) return;
    const next = [...selectedIds, id];
    onChange(next, effectivePrimary || id);
  };

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className={`text-[10px] uppercase tracking-[0.18em] mb-2 ${dark ? 'text-cream/60' : 'text-earth/60'}`}>
        Subcategories <span className="normal-case tracking-normal">(choose all that apply)</span>
      </legend>
      <div className={`grid ${compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'} gap-2`}>
        {leaves.map((category) => {
          const selected = selectedIds.includes(category.id);
          const parent = collection.subcategories.find((candidate) => candidate.id === getCategoryParentId(category, collection));
          return (
            <div key={category.id} className={`rounded-xl border p-3 transition ${selected ? 'border-bronze bg-bronze/10' : (dark ? 'border-white/10 bg-white/5' : 'border-earth/15 bg-white/40')}`}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggle(category.id)}
                  className="sr-only"
                />
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-bronze bg-bronze text-white' : (dark ? 'border-white/30' : 'border-earth/30')}`}>
                  {selected && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm ${dark ? 'text-cream' : 'text-earth'}`}>{category.title}</span>
                  {parent && <span className={`block text-[10px] uppercase tracking-wider ${dark ? 'text-cream/50' : 'text-earth/50'}`}>{parent.title}</span>}
                </span>
              </label>
              {selected && selectedIds.length > 1 && (
                <label className={`mt-2 ml-8 flex cursor-pointer items-center gap-2 text-[10px] uppercase tracking-wider ${dark ? 'text-cream/60' : 'text-earth/60'}`}>
                  <input
                    type="radio"
                    name={`primary-subcategory-${collection.id}`}
                    checked={effectivePrimary === category.id}
                    onChange={() => onChange(selectedIds, category.id)}
                  />
                  Primary
                </label>
              )}
            </div>
          );
        })}
      </div>
      {selectedIds.length >= MAX_PRODUCT_SUBCATEGORIES && (
        <p className={`text-xs ${dark ? 'text-amber-300' : 'text-amber-700'}`}>Maximum of {MAX_PRODUCT_SUBCATEGORIES} subcategories selected.</p>
      )}
      {selectedIds.length === 0 && <p className={`text-xs ${dark ? 'text-cream/50' : 'text-earth/50'}`}>No subcategory selected.</p>}
    </fieldset>
  );
};
