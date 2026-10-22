import React, { useState } from 'react';
import { ShoppingBag, Check } from 'lucide-react';
import { useCart } from '../../contexts/CartContext';
import { Product, ProductVariant } from '../../types';

interface AddToCartButtonProps {
    product: Product;
    selectedVariant?: ProductVariant;  // Optional variant selection
    variantRequired?: boolean;  // True if product has variants and selection is required
    className?: string;
    variant?: 'primary' | 'secondary' | 'icon';
}

export const AddToCartButton: React.FC<AddToCartButtonProps> = ({
    product,
    selectedVariant,
    variantRequired = false,
    className = '',
    variant = 'primary'
}) => {
    const { addToCart } = useCart();
    const [isAdded, setIsAdded] = useState(false);

    // Disabled if out of stock OR if variant is required but not selected
    const needsVariantSelection = variantRequired && !selectedVariant;
    const comingSoon = product.fulfillmentProvider !== 'ashcroft' || !product.inStock;
    const isDisabled = comingSoon || !product.inStock || needsVariantSelection || selectedVariant?.inStock === false;

    const handleClick = () => {
        if (isDisabled) return;

        addToCart(product, 1, selectedVariant);
        setIsAdded(true);

        // Reset after animation
        setTimeout(() => setIsAdded(false), 1500);
    };

    // Determine button text based on state
    const getButtonText = () => {
        if (isAdded) return null; // Will show "Added!" with icon
        if (!product.inStock || selectedVariant?.inStock === false) return 'Out of Stock';
        if (needsVariantSelection) return 'Select Option First';
        return null; // Will show "Add to Cart" with icon
    };

    const buttonText = getButtonText();

    if (comingSoon) return <button disabled className={`w-full py-4 text-earth/60 border border-earth/20 rounded-lg ${className}`}>Coming Soon</button>;

    if (variant === 'icon') {
        return (
            <button
                onClick={handleClick}
                disabled={isDisabled}
                className={`p-3 bg-earth text-cream hover:bg-bronze transition-all disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
                aria-label={isDisabled ? (needsVariantSelection ? 'Select Option First' : 'Out of Stock') : 'Add to Cart'}
            >
                {isAdded ? (
                    <Check className="w-4 h-4" />
                ) : (
                    <ShoppingBag className="w-4 h-4" />
                )}
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
                        Add to Cart
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
                    Add to Cart
                </>
            )}
        </button>
    );
};

export default AddToCartButton;
