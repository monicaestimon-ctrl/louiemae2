import React, { useRef } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useCart, CartItem as CartItemType } from '../../contexts/CartContext';
import { SafeImage } from '../SafeImage';
import type { CurrentCartReview } from '../../lib/cartCurrentReview';

interface CartItemProps {
    item: CartItemType;
    review: CurrentCartReview;
}

export const CartItem: React.FC<CartItemProps> = ({ item, review }) => {
    const { updateQuantity, removeFromCart, acceptCurrentItem } = useCart();
    const { product, quantity, selectedVariant } = item;
    const titleRef = useRef<globalThis.HTMLHeadingElement>(null);
    const itemLabel = selectedVariant?.name ? `${product.name} — ${selectedVariant.name}` : product.name;

    // Use variant image if available, otherwise product's first image
    const displayImage = selectedVariant?.image || product.images[0];

    // Calculate price with variant adjustment
    const displayPrice = product.price + ((selectedVariant ?? product.variants?.[0])?.priceAdjustment || 0);
    const currentPrice = review.product && review.variant ? review.product.price + review.variant.priceAdjustment : undefined;
    const lower = review.choices.find(value => value < quantity);
    const upper = review.choices.find(value => value > quantity);
    const rules = review.variant?.quantityRules;

    return (
        <div className="py-4 border-b border-earth/10">
        <div className="flex gap-4">
            {/* Product Image */}
            <div className="w-20 h-20 bg-cream flex-shrink-0 overflow-hidden">
                {displayImage ? <SafeImage
                    src={displayImage}
                    fallbackSrc="/images/product-unavailable.svg"
                    media={product.imageMedia} sizes="80px"
                    alt={product.name}
                    className="w-full h-full object-cover"
                /> : <span className="flex h-full items-center p-2 text-xs text-muted-earth">Image unavailable</span>}
            </div>

            {/* Product Details */}
            <div className="flex-1 min-w-0">
                <h3 ref={titleRef} tabIndex={-1} className="font-serif text-sm text-earth break-words">{product.name}</h3>
                {selectedVariant && (
                    <p className="text-xs text-muted-earth mt-0.5">{selectedVariant.name}</p>
                )}
                <p className="text-[10px] uppercase tracking-widest text-muted-earth mt-1">
                    {product.category}
                </p>
                <p className="text-sm text-earth mt-1">${displayPrice.toFixed(2)}</p>
            </div>
        </div>

            {/* Quantity Controls */}
            <div className="mt-3 flex items-center justify-between">
                <button
                    onClick={() => removeFromCart(product.id, selectedVariant?.id)}
                    className="min-w-11 min-h-11 p-2 text-muted-earth hover:text-red-600 transition-colors"
                    aria-label={`Remove ${itemLabel}`}
                >
                    <Trash2 className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-2 border border-earth/10">
                    <button
                        onClick={() => lower !== undefined && updateQuantity(product.id, lower, selectedVariant?.id)}
                        disabled={review.status !== 'ready' || lower === undefined}
                        className="min-w-11 min-h-11 p-2 hover:bg-earth/5 transition-colors"
                        aria-label={`Decrease quantity of ${itemLabel}`}
                    >
                        <Minus className="w-3 h-3 text-earth" />
                    </button>
                    <span className="text-sm text-earth w-6 text-center">{quantity}</span>
                    <button
                        onClick={() => upper !== undefined && updateQuantity(product.id, upper, selectedVariant?.id)}
                        disabled={review.status !== 'ready' || upper === undefined}
                        className="min-w-11 min-h-11 p-2 hover:bg-earth/5 transition-colors"
                        aria-label={`Increase quantity of ${itemLabel}`}
                    >
                        <Plus className="w-3 h-3 text-earth" />
                    </button>
                </div>
            </div>
        <div className="mt-3 text-sm text-earth" aria-live="polite">
            {rules && <p>Minimum {rules.minimum}; order increments of {rules.increment}.{rules.piecesPerPack ? ` ${rules.piecesPerPack} pieces per pack.` : ''}</p>}
            {review.status === 'pending' && <p>Checking current price and availability…</p>}
            {review.status === 'error' && <p>Current details could not be checked. Retry below or remove this item.</p>}
            {review.status === 'unavailable' && <p>This option cannot currently be purchased. Your saved item is retained; remove it to continue with other items.</p>}
            {review.status === 'changed' && review.product && review.variant && <>
                <p>Review updated price and order details: ${currentPrice!.toFixed(2)} {rules?.piecesPerPack ? 'per pack' : 'each'}; ${(currentPrice! * quantity).toFixed(2)} for quantity {quantity}.</p>
                {(product.deliveryFee ?? 0) !== (review.product.deliveryFee ?? 0) && <p>Economy delivery per quantity: ${(product.deliveryFee ?? 0).toFixed(2)} → ${(review.product.deliveryFee ?? 0).toFixed(2)}.</p>}
                <button type="button" className="min-h-11 underline" onClick={() => { titleRef.current?.focus(); acceptCurrentItem(product.id, selectedVariant?.id, review.product!, review.variant!); }}>Accept updated details for {itemLabel}</button>
            </>}
            {review.status === 'quantity' && <>
                <p>Quantity {quantity} does not meet the current order rules. Choose a quantity to continue.</p>
                {review.choices.map(choice => <button key={choice} type="button" className="min-h-11 mr-3 underline" onClick={() => { titleRef.current?.focus(); updateQuantity(product.id, choice, selectedVariant?.id); }}>Choose {choice} · ${(currentPrice! * choice).toFixed(2)}</button>)}
                {!review.choices.length && <p>Please contact us for a project quote.</p>}
            </>}
        </div>
        </div>
    );
};

export default CartItem;
