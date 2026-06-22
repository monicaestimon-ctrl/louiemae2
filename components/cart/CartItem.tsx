import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useCart, CartItem as CartItemType } from '../../contexts/CartContext';
import { SafeImage } from '../SafeImage';

interface CartItemProps {
    item: CartItemType;
}

export const CartItem: React.FC<CartItemProps> = ({ item }) => {
    const { updateQuantity, removeFromCart } = useCart();
    const { product, quantity, selectedVariant } = item;

    // Use variant image if available, otherwise product's first image
    const displayImage = selectedVariant?.image || product.images[0];

    // Calculate price with variant adjustment
    const displayPrice = product.price + (selectedVariant?.priceAdjustment || 0);

    return (
        <div className="flex gap-4 py-4 border-b border-earth/10">
            {/* Product Image */}
            <div className="w-20 h-20 bg-cream flex-shrink-0 overflow-hidden">
                <SafeImage
                    src={displayImage}
                    alt={product.name}
                    className="w-full h-full object-cover"
                />
            </div>

            {/* Product Details */}
            <div className="flex-1 min-w-0">
                <h4 className="font-serif text-sm text-earth truncate">{product.name}</h4>
                {selectedVariant && (
                    <p className="text-xs text-earth/60 mt-0.5">{selectedVariant.name}</p>
                )}
                <p className="text-[10px] uppercase tracking-widest text-earth/50 mt-1">
                    {product.category}
                </p>
                <p className="text-sm text-earth mt-1">${displayPrice.toFixed(2)}</p>
            </div>

            {/* Quantity Controls */}
            <div className="flex flex-col items-end justify-between">
                <button
                    onClick={() => removeFromCart(product.id, selectedVariant?.id)}
                    className="p-1 text-earth/30 hover:text-red-600 transition-colors"
                    aria-label="Remove item"
                >
                    <Trash2 className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-2 border border-earth/10">
                    <button
                        onClick={() => updateQuantity(product.id, quantity - 1, selectedVariant?.id)}
                        className="p-1 hover:bg-earth/5 transition-colors"
                        aria-label="Decrease quantity"
                    >
                        <Minus className="w-3 h-3 text-earth" />
                    </button>
                    <span className="text-sm text-earth w-6 text-center">{quantity}</span>
                    <button
                        onClick={() => updateQuantity(product.id, quantity + 1, selectedVariant?.id)}
                        className="p-1 hover:bg-earth/5 transition-colors"
                        aria-label="Increase quantity"
                    >
                        <Plus className="w-3 h-3 text-earth" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CartItem;
