import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Product, ProductVariant } from '../types';

export interface CartItem {
    product: Product;
    quantity: number;
    selectedVariant?: ProductVariant;  // Tracks which variant was selected
}

interface CartContextType {
    items: CartItem[];
    addToCart: (product: Product, quantity?: number, variant?: ProductVariant) => void;
    removeFromCart: (productId: string, variantId?: string) => void;
    updateQuantity: (productId: string, quantity: number, variantId?: string) => void;
    clearCart: () => void;
    isOpen: boolean;
    openCart: () => void;
    closeCart: () => void;
    toggleCart: () => void;
    itemCount: number;
    subtotal: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'louiemae_ashcroft_cart_v1';

// Helper to create unique cart key for product + variant
const getCartItemKey = (productId: string, variantId?: string) =>
    variantId ? `${productId}:${variantId}` : productId;

export const CartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [items, setItems] = useState<CartItem[]>(() => {
        // Load from localStorage on initial render
        try {
            const saved = localStorage.getItem(CART_STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    const [isOpen, setIsOpen] = useState(false);

    // Persist to localStorage whenever items change
    useEffect(() => {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    }, [items]);

    const addToCart = (product: Product, quantity: number = 1, variant?: ProductVariant) => {
        if (product.fulfillmentProvider !== 'ashcroft') return;
        setItems(prev => {
            const key = getCartItemKey(product.id, variant?.id);
            const existingIndex = prev.findIndex(item =>
                getCartItemKey(item.product.id, item.selectedVariant?.id) === key
            );

            if (existingIndex >= 0) {
                // Update quantity of existing item
                const updated = [...prev];
                updated[existingIndex] = {
                    ...updated[existingIndex],
                    quantity: updated[existingIndex].quantity + quantity
                };
                return updated;
            }

            // Add new item
            return [...prev, { product, quantity, selectedVariant: variant }];
        });

        // Open cart drawer when adding
        setIsOpen(true);
    };

    const removeFromCart = (productId: string, variantId?: string) => {
        const key = getCartItemKey(productId, variantId);
        setItems(prev => prev.filter(item =>
            getCartItemKey(item.product.id, item.selectedVariant?.id) !== key
        ));
    };

    const updateQuantity = (productId: string, quantity: number, variantId?: string) => {
        if (quantity <= 0) {
            removeFromCart(productId, variantId);
            return;
        }

        const key = getCartItemKey(productId, variantId);
        setItems(prev => prev.map(item =>
            getCartItemKey(item.product.id, item.selectedVariant?.id) === key
                ? { ...item, quantity }
                : item
        ));
    };

    const clearCart = () => {
        setItems([]);
    };

    const openCart = () => setIsOpen(true);
    const closeCart = () => setIsOpen(false);
    const toggleCart = () => setIsOpen(prev => !prev);

    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    // Include variant price adjustments in subtotal
    const subtotal = items.reduce((sum, item) => {
        const basePrice = item.product.price;
        const adjustment = item.selectedVariant?.priceAdjustment || 0;
        return sum + ((basePrice + adjustment) * item.quantity);
    }, 0);

    return (
        <CartContext.Provider value={{
            items,
            addToCart,
            removeFromCart,
            updateQuantity,
            clearCart,
            isOpen,
            openCart,
            closeCart,
            toggleCart,
            itemCount,
            subtotal
        }}>
            {children}
        </CartContext.Provider>
    );
};

export const useCart = () => {
    const context = useContext(CartContext);
    if (context === undefined) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
};
