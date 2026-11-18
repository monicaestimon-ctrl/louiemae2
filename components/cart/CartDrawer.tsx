import { Modal } from '../Modal';
import { rememberCheckout, cartLines } from '../../lib/delivery/checkoutReturn';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { X, ShoppingBag, Loader2 } from 'lucide-react';
import { useQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useAuthToken } from '@convex-dev/auth/react';
import { api } from '../../convex/_generated/api';
import { useCart } from '../../contexts/CartContext';
import CartItem from './CartItem';
import { useCurrentCartReview } from './useCurrentCartReview';
import { activeRef, visitorId } from '../../lib/partnerLink';
import CheckoutV2 from '../delivery/CheckoutV2';
import { ErrorBoundary } from '../ErrorBoundary';
import { usePendingTimeout } from '../../contexts/usePendingTimeout';
import { checkoutDraftOwner, type CheckoutDraft } from '../../lib/delivery/checkoutDraft';
const CREDIT_QUERY = { credit: { query: api.holmCredit.myCredit, args: {} } };
const NO_QUERIES = {};

/** Preserve cart drafts while gating checkout on verified account credit and delivery data. */
export const CartDrawer: React.FC = () => {
    const { isOpen, closeCart, items, subtotal, itemCount, removeFromCart, notice } = useCart();
    const current = useCurrentCartReview(items, isOpen);
    // Zuo items (or a mixed cart) use the v2 checkout: full-address delivery and tax before payment.
    const hasV2 = items.some((item) => item.product.fulfillmentProvider === 'zuo');
    const delivery = items.reduce((sum, item) => sum + (item.product.deliveryFee ?? 0) * item.quantity, 0);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    // Store credit (signed-in members): pre-set from their Hub setting, changeable per order.
    const authToken = useAuthToken();
    const draftOwner = checkoutDraftOwner(authToken);
    const { owner: checkoutOwner, ref: checkoutDraftRef } = useMemo(() => ({ owner: draftOwner, ref: React.createRef<CheckoutDraft>() }), [draftOwner]);
    useEffect(() => { if (!items.length) checkoutDraftRef.current = null; }, [items.length, checkoutDraftRef]);
    const needsCredit = isOpen && !hasV2 && Boolean(authToken);
    const creditResults = useQueries(needsCredit ? CREDIT_QUERY : NO_QUERIES);
    const creditResult = creditResults.credit as FunctionReturnType<typeof api.holmCredit.myCredit> | Error | undefined;
    const credit = needsCredit && !(creditResult instanceof Error) ? creditResult : undefined;
    const creditPending = needsCredit && creditResult === undefined;
    const creditTimedOut = usePendingTimeout(creditPending);
    const creditBlocked = needsCredit && (creditPending || creditResult === null || creditResult instanceof Error);
    const [useCredit, setUseCredit] = useState(false);
    const autoApply = credit?.autoApply;
    useEffect(() => { if (autoApply !== undefined) setUseCredit(autoApply); }, [autoApply]);
    const creditOff = credit && useCredit ? Math.min(credit.balanceCents / 100, subtotal) : 0;
    const [error, setError] = useState<string | null>(null);
    const [checkoutBlock, setCheckoutBlock] = useState<{
        message: string;
        items: Array<{
            productId?: string;
            variantId?: string;
            name: string;
            reason?: string;
        }>;
    } | null>(null);
    const requestSequence = useRef(0);
    useEffect(() => {
        requestSequence.current++;
        setIsCheckingOut(false);
        return () => { requestSequence.current++; };
    }, [current.fingerprint, current.blocked, checkoutOwner, useCredit]);

    const handleCheckout = async () => {
        if (items.length === 0 || creditBlocked || current.blocked) return;
        const seq = ++requestSequence.current;

        setIsCheckingOut(true);
        setError(null);
        setCheckoutBlock(null);

        try {
            // Get Convex URL from environment
            const convexUrl = import.meta.env.VITE_CONVEX_URL;
            if (!convexUrl) {
                throw new Error('Convex not configured');
            }

            // Extract the site ID from convex URL and construct HTTP endpoint
            const siteId = convexUrl.replace('https://', '').replace('.convex.cloud', '');
            const httpUrl = `https://${siteId}.convex.site/stripe/checkout`;

            // Prepare cart items for Stripe
            const checkoutItems = items.map(item => {
                const option = item.selectedVariant ?? item.product.variants?.[0];
                const variantAdjustment = option?.priceAdjustment || 0;
                const itemName = option
                    ? `${item.product.name} - ${option.name}`
                    : item.product.name;
                const itemImage = option?.image || item.product.images[0];

                return {
                    productId: item.product.id,
                    variantId: option?.id,
                    variantName: option?.name,
                    name: itemName,
                    price: item.product.price + variantAdjustment,
                    quantity: item.quantity,
                    reviewed: { merchandiseMinor: Math.round((item.product.price + variantAdjustment) * 100), deliveryMinor: Math.round((item.product.deliveryFee ?? 0) * 100) },
                    image: itemImage || undefined,
                };
            });

            // Create checkout session
            const response = await fetch(httpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // signed in: lets the server use this member's store credit
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
                body: JSON.stringify({
                    items: checkoutItems,
                    reviewVersion: 1,
                    // the partner link this visitor arrived through, if any (checked on the server)
                    ...(activeRef() ? { refCode: activeRef()!.code, visitorId: visitorId() } : {}),
                    ...(creditOff > 0 ? { useCredit: true } : {}),
                    successUrl: `${window.location.origin}/#checkout/success?session_id={CHECKOUT_SESSION_ID}`,
                    cancelUrl: `${window.location.origin}/#checkout/cancel`,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                if (seq !== requestSequence.current) return;
                if (errorData?.code === 'PRICE_CHANGED') {
                    current.retry();
                    throw new Error('Your prices or delivery charges changed. Review the updated cart before checkout.');
                }
                if (errorData?.code === 'OUT_OF_STOCK' || Array.isArray(errorData?.unavailableItems)) {
                    setCheckoutBlock({
                        message: errorData?.error || "We're sorry, one or more items in your cart are no longer available. Please remove the unavailable item before checking out.",
                        items: Array.isArray(errorData?.unavailableItems) ? errorData.unavailableItems : [],
                    });
                    setIsCheckingOut(false);
                    return;
                }
                throw new Error(errorData.error || 'Checkout failed');
            }

            const { url, sessionId } = await response.json();
            if (seq !== requestSequence.current) return;

            // Redirect to Stripe Checkout
            if (url) {
                if (sessionId) rememberCheckout(sessionId, undefined, cartLines(items));
                window.location.href = url;
            } else {
                throw new Error('No checkout URL received');
            }
        } catch (err: unknown) {
            if (seq !== requestSequence.current) return;
            console.error('Checkout error:', err);
            setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
            setIsCheckingOut(false);
        }
    };

    const handleRemoveBlockedItem = (productId?: string, variantId?: string) => {
        if (!productId) return;
        removeFromCart(productId, variantId);
        setCheckoutBlock(prev => {
            if (!prev) return null;
            const remaining = prev.items.filter(item => !(item.productId === productId && item.variantId === variantId));
            return remaining.length > 0 ? { ...prev, items: remaining } : null;
        });
    };

    if (!isOpen) return null;

    return (
        <Modal open={isOpen} label="Your cart" onClose={closeCart}>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] transition-opacity"
                onClick={closeCart}
            />

            {/* Drawer */}
            <div data-cart-panel className="fixed top-0 right-0 h-full w-full max-w-md bg-white z-[201] shadow-2xl overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-white flex items-center justify-between p-6 border-b border-earth/10">
                    <div className="flex items-center gap-3">
                        <ShoppingBag className="w-5 h-5 text-earth" />
                        <h2 className="font-serif text-xl text-earth">Your Cart</h2>
                        <span className="text-[10px] uppercase tracking-widest text-muted-earth">
                            (Quantity {itemCount})
                        </span>
                    </div>
                    <button
                        onClick={closeCart}
                        className="p-2 text-muted-earth hover:text-earth transition-colors"
                        aria-label="Close cart"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {current.overLimit && <p role="status" className="px-6 pt-4 text-sm text-earth">Your cart has more than 30 product options. Remove options until 30 remain, or contact us for a project quote. Retry cannot resolve this limit.</p>}
                {notice && <p role="status" className="px-6 pt-4 text-sm text-earth">{notice}</p>}
                {/* Cart Items */}
                <div className="p-6">
                    {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <ShoppingBag className="w-16 h-16 text-earth/20 mb-4" />
                            <p className="font-serif text-xl text-muted-earth mb-2">Your cart is empty</p>
                            <p className="text-sm text-muted-earth">
                                Add some beautiful pieces to get started
                            </p>
                            <button
                                onClick={closeCart}
                                className="mt-6 text-[10px] uppercase tracking-widest text-bronze hover:text-earth transition-colors"
                            >
                                Continue Shopping
                            </button>
                        </div>
                    ) : (
                        <div>
                            {items.map((item, index) => {
                                const key = item.selectedVariant
                                    ? `${item.product.id}:${item.selectedVariant.id}`
                                    : item.product.id;
                                return <CartItem key={key} item={item} review={current.reviews[index]} />;
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {items.length > 0 && (
                    <div className="border-t border-earth/10 p-6 bg-cream/30">
                        {/* Subtotal */}
                        <div className="flex justify-between items-center mb-4">
                            <span className="text-[10px] uppercase tracking-widest text-muted-earth">{current.blocked ? 'Saved subtotal · review required' : 'Subtotal'}</span>
                            <span className="font-serif text-xl text-earth">${subtotal.toFixed(2)}</span>
                        </div>

                        {!hasV2 && credit && credit.balanceCents > 0 && (
                            <label className="flex items-center justify-between gap-3 mb-3 text-xs text-earth">
                                <span className="flex items-center gap-2">
                                    <input type="checkbox" disabled={isCheckingOut} checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} />
                                    Use my ${(credit.balanceCents / 100).toFixed(2)} store credit
                                </span>
                                {creditOff > 0 && <span className="font-serif text-base">−${creditOff.toFixed(2)}</span>}
                            </label>
                        )}

                        {current.blocked && <p role="status" className="text-earth mb-4">Review your cart items before checkout. Your items and delivery details are saved.</p>}
                        {!current.overLimit && current.reviews.some(review => review.status === 'error') && <button type="button" className="min-h-11 underline" onClick={current.retry}>Retry current product details</button>}
                        {hasV2 ? <ErrorBoundary fallback={<p role="alert" className="text-earth">Checkout is temporarily unavailable. Close and reopen your cart to try again. Your items are saved.</p>}><CheckoutV2 key={checkoutOwner} draftRef={checkoutDraftRef} reviewBlocked={current.blocked} reviewFingerprint={current.fingerprint} /></ErrorBoundary> : (<>
                        {creditBlocked && <p role="status" className="text-earth mb-4">
                            {creditPending && !creditTimedOut ? 'Checking your store credit…' : 'Store credit could not be verified. Close and reopen your cart to try again. Your items are saved.'}
                        </p>}
                        <p className="text-[10px] text-muted-earth mb-4 text-center">
                            Economy delivery: ${delivery.toFixed(2)} · Total before tax: ${(subtotal - creditOff + delivery).toFixed(2)}. Delivery is charged per item; tax is calculated at checkout.{creditOff > 0 ? ' Store credit comes off the items, not delivery or tax.' : ''}
                        </p>

                        {/* Error Message */}
                        {checkoutBlock && (
                            <div className="bg-[#fbf4ef] border border-[#d7a77d]/40 rounded-md p-3 mb-4">
                                <p className="text-xs leading-relaxed text-earth">{checkoutBlock.message}</p>
                                {checkoutBlock.items.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                        {checkoutBlock.items.map((blockedItem, index) => (
                                            <div key={`${blockedItem.productId || blockedItem.name}-${blockedItem.variantId || index}`} className="flex items-start justify-between gap-3 rounded-sm bg-white/70 border border-earth/10 p-2">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-medium text-earth truncate">{blockedItem.name}</p>
                                                    {blockedItem.reason && (
                                                        <p className="mt-1 text-[10px] leading-snug text-muted-earth">{blockedItem.reason}</p>
                                                    )}
                                                </div>
                                                {blockedItem.productId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveBlockedItem(blockedItem.productId, blockedItem.variantId)}
                                                        className="flex-shrink-0 text-[9px] uppercase tracking-widest text-bronze hover:text-earth transition-colors"
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                                <p className="text-xs text-red-600">{error}</p>
                            </div>
                        )}

                        {/* Checkout Button */}
                        <button
                            className="w-full bg-earth text-cream py-4 text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={handleCheckout}
                            disabled={isCheckingOut || creditBlocked || current.blocked}
                        >
                            {isCheckingOut ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                'Proceed to Checkout'
                            )}
                        </button>
                        </>)}

                        {/* Continue Shopping */}
                        <button
                            onClick={closeCart}
                            className="w-full mt-3 py-3 text-[10px] uppercase tracking-widest text-muted-earth hover:text-earth transition-colors"
                        >
                            Continue Shopping
                        </button>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default CartDrawer;
