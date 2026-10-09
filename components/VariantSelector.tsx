import React, { useMemo } from 'react';
import type { ProductVariant } from '../types';
import { SafeImage } from './SafeImage';

export const NO_IMAGE_KEY = '__no_image__';

/** Extracted variant selector with memoized image grouping */
interface VariantSelectorProps {
  variants: ProductVariant[];
  selectedVariant: ProductVariant | undefined;
  activeImageGroupKey: string | null;
  onSelectVariant: (v: ProductVariant | undefined) => void;
  onSetGroupKey: (key: string | null) => void;
}

export const VariantSelector: React.FC<VariantSelectorProps> = React.memo(({
  variants,
  selectedVariant,
  activeImageGroupKey,
  onSelectVariant,
  onSetGroupKey,
}) => {
  // Memoize image grouping so it only recalculates when variants change
  const { groupEntries, imageGroups, hasMultipleGroups } = useMemo(() => {
    const groups = new Map<string, ProductVariant[]>();
    variants.forEach(v => {
      const key = v.image || NO_IMAGE_KEY;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    });
    return {
      imageGroups: groups,
      groupEntries: Array.from(groups.entries()),
      hasMultipleGroups: groups.size > 1,
    };
  }, [variants]);

  // Determine active group: explicit key > selected variant's group > first group
  const resolvedGroupKey = activeImageGroupKey || (selectedVariant?.image || NO_IMAGE_KEY);
  const activeGroup = imageGroups.get(resolvedGroupKey) || groupEntries[0]?.[1] || [];
  const currentGroupKey = imageGroups.has(resolvedGroupKey) ? resolvedGroupKey : groupEntries[0]?.[0] || NO_IMAGE_KEY;

  // Variant button styles
  const variantBtnClass = (v: ProductVariant) =>
    `px-4 py-2 text-xs uppercase tracking-wider border transition-all rounded-sm ${
      selectedVariant?.id === v.id
        ? 'border-earth bg-earth text-cream'
        : v.inStock
          ? 'border-earth/20 text-earth hover:border-earth'
          : 'border-earth/10 text-earth/30 cursor-not-allowed line-through'
    }`;

  if (!hasMultipleGroups) {
    // Single group — flat buttons
    return (
      <>
        <span className="text-[10px] uppercase tracking-widest text-earth/50 block mb-3">Select Option</span>
        <div className="flex flex-wrap gap-2">
          {variants.map(v => (
            <button
              key={v.id}
              onClick={() => onSelectVariant(v.id === selectedVariant?.id ? undefined : v)}
              disabled={!v.inStock}
              className={variantBtnClass(v)}
            >
              {v.name}
            </button>
          ))}
        </div>
      </>
    );
  }

  // Multi-group — tier 1: image/color swatches, tier 2: size buttons
  return (
    <>
      {/* Tier 1: Color/Style */}
      <span className="text-[10px] uppercase tracking-widest text-earth/50 block mb-3">Select Style</span>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
        {groupEntries.map(([imageKey, groupVariants]) => {
          const isActive = currentGroupKey === imageKey;
          const hasImage = imageKey !== NO_IMAGE_KEY;
          const firstVariant = groupVariants[0];
          const anyInStock = groupVariants.some(v => v.inStock);

          return (
            <button
              key={imageKey}
              onClick={() => {
                onSetGroupKey(imageKey);
                if (selectedVariant && (selectedVariant.image || NO_IMAGE_KEY) !== imageKey) {
                  onSelectVariant(undefined);
                }
                if (groupVariants.length === 1) {
                  onSelectVariant(firstVariant);
                }
              }}
              disabled={!anyInStock}
              className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all duration-200
                ${isActive
                  ? 'border-earth ring-2 ring-earth/20 shadow-md scale-[1.02]'
                  : anyInStock
                    ? 'border-earth/15 hover:border-earth/40 hover:shadow-sm'
                    : 'border-earth/10 opacity-40 cursor-not-allowed'}`}
            >
              {hasImage ? (
                <SafeImage src={imageKey} alt={firstVariant.name} className="w-14 h-14 md:w-16 md:h-16 object-cover" />
              ) : (
                <div className="w-14 h-14 md:w-16 md:h-16 bg-earth/5 flex items-center justify-center text-[9px] text-earth/40 uppercase tracking-wider px-1 text-center">
                  {firstVariant.name.split(/[\s-]/)[0]}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Tier 2: Size/Option within selected group */}
      {activeGroup.length > 0 && (
        <>
          <span className="text-[10px] uppercase tracking-widest text-earth/50 block mb-3">
            {activeGroup.length === 1 ? 'Selected' : 'Select Size'}
          </span>
          <div className="flex flex-wrap gap-2">
            {activeGroup.map(v => (
              <button
                key={v.id}
                onClick={() => onSelectVariant(v.id === selectedVariant?.id ? undefined : v)}
                disabled={!v.inStock}
                className={variantBtnClass(v)}
              >
                {v.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
});
VariantSelector.displayName = 'VariantSelector';

