import React, { useState, useRef, useEffect } from 'react';
import { ShoppingBag, Check } from 'lucide-react';
import { useCart } from '../../contexts/CartContext';
import { Product, ProductVariant } from '../../types';
import { publicQuantityRules } from '../../lib/orderQuantity';

interface AddToCartButtonProps {
  product: Product;
  selectedVariant?: ProductVariant; // Optional variant selection
  variantRequired?: boolean; // True if product has variants and selection is required
  className?: string;
  variant?: 'primary' | 'secondary' | 'icon';
}

export const AddToCartButton: React.FC<AddToCartButtonProps> = ({
  product,
  selectedVariant,
  variantRequired = false,
  className = '',
  variant = 'primary',
}) => {
  const { addToCart, items = [] } = useCart();
  const [pendingAdd, setPendingAdd] = useState<{
    previous: typeof items;
    variantId?: string;
    quantity: number;
  } | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(resetTimer.current);
    },
    []
  );
  const isAdded =
    pendingAdd !== null &&
    items !== pendingAdd.previous &&
    items.some(
      (item) =>
        item.product.id === product.id &&
        (item.selectedVariant?.id ?? item.product.variants?.[0]?.id) === pendingAdd.variantId &&
        item.quantity === pendingAdd.quantity
    );

  // Disabled if out of stock OR if variant is required but not selected
  const needsVariantSelection = variantRequired && !selectedVariant;
  const option = selectedVariant ?? (!variantRequired ? product.variants?.[0] : undefined);
  const suppliedRules = option?.quantityRules;
  const rules =
    suppliedRules &&
    publicQuantityRules(
      suppliedRules.minimum,
      suppliedRules.increment,
      suppliedRules.piecesPerPack
    );
  const quantityUnavailable = !rules;
  const addLabel =
    rules && (rules.minimum > 1 || rules.piecesPerPack)
      ? `Add ${rules.minimum}${rules.piecesPerPack ? ` ${rules.minimum === 1 ? 'pack' : 'packs'} (${rules.piecesPerPack} pieces per pack)` : ''} to Cart · $${((product.price + (option?.priceAdjustment ?? 0)) * rules.minimum).toFixed(2)}`
      : 'Add to Cart';
  const comingSoon =
    product.fulfillmentProvider !== 'ashcroft' && product.fulfillmentProvider !== 'zuo';
  const isDisabled =
    comingSoon ||
    !product.inStock ||
    needsVariantSelection ||
    option?.inStock !== true ||
    quantityUnavailable;

  const handleClick = () => {
    if (isDisabled) return;

    const previous = items.find(
      (item) =>
        item.product.id === product.id &&
        (item.selectedVariant?.id ?? item.product.variants?.[0]?.id) === option?.id
    );
    setPendingAdd({
      previous: items,
      variantId: option?.id,
      quantity: (previous?.quantity ?? 0) + rules!.minimum,
    });
    addToCart(product, rules!.minimum, option);

    // Reset after animation
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setPendingAdd(null), 1500);
  };

  // Determine button text based on state
  const getButtonText = () => {
    if (isAdded) return null; // Will show "Added!" with icon
    if (!product.inStock || option?.inStock === false) return 'Out of Stock';
    if (needsVariantSelection) return 'Select Option First';
    if (quantityUnavailable) return 'Refresh product details before adding';
    return null; // Will show "Add to Cart" with icon
  };

  const buttonText = getButtonText();

  if (comingSoon)
    return (
      <button
        disabled
        className={`w-full py-4 text-earth/60 border border-earth/20 rounded-lg ${className}`}
      >
        Coming Soon
      </button>
    );

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        disabled={isDisabled}
        className={`p-3 bg-earth text-cream hover:bg-bronze transition-all disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        aria-label={buttonText ?? addLabel}
      >
        {isAdded ? <Check className="w-4 h-4" /> : <ShoppingBag className="w-4 h-4" />}
      </button>
    );
  }

  if (variant === 'secondary') {
    return (
      <button
        onClick={handleClick}
        disabled={isDisabled}
        className={`px-6 py-3 border border-earth text-earth text-[10px] uppercase tracking-[0.2em] hover:bg-earth hover:text-cream transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${className}`}
      >
        {isAdded ? (
          <>
            <Check className="w-4 h-4" />
            Added!
          </>
        ) : buttonText ? (
          buttonText
        ) : (
          <>
            <ShoppingBag className="w-4 h-4" />
            {addLabel}
          </>
        )}
      </button>
    );
  }

  // Primary variant (default)
  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className={`w-full bg-earth text-cream py-4 text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${className}`}
    >
      {isAdded ? (
        <>
          <Check className="w-4 h-4" />
          Added to Cart!
        </>
      ) : buttonText ? (
        buttonText
      ) : (
        <>
          <ShoppingBag className="w-4 h-4" />
          {addLabel}
        </>
      )}
    </button>
  );
};

export default AddToCartButton;
