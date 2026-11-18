import {
  CART_STORAGE_KEY,
  restoreCart,
  savedCartItem,
  validCartQuantity,
} from '../lib/cartStorage';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Product, ProductVariant } from '../types';

export interface CartItem {
  product: Product;
  quantity: number;
  selectedVariant?: ProductVariant; // Tracks which variant was selected
}

interface CartContextType {
  items: CartItem[];
  notice: string;
  addToCart: (product: Product, quantity?: number, variant?: ProductVariant) => void;
  removeFromCart: (productId: string, variantId?: string) => void;
  updateQuantity: (productId: string, quantity: number, variantId?: string) => void;
  acceptCurrentItem: (productId: string, variantId: string | undefined, product: Product, variant: ProductVariant) => void;
  clearCart: () => void;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  itemCount: number;
  subtotal: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

// Helper to create unique cart key for product + variant
const getCartItemKey = (productId: string, variantId?: string) =>
  JSON.stringify([productId, variantId]);

export const CartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState(() => {
    try {
      const restored = restoreCart(localStorage.getItem(CART_STORAGE_KEY));
      return { items: restored.items, notice: restored.recoveryNotice };
    } catch {
      return {
        items: [] as CartItem[],
        notice:
          'Your browser cannot save this cart. Items will remain available during this visit.',
      };
    }
  });
  const { items, notice } = cart;
  const setItems = (update: CartItem[] | ((previous: CartItem[]) => CartItem[])) =>
    setCart((previous) => ({
      ...previous,
      items: typeof update === 'function' ? update(previous.items) : update,
    }));
  const setNotice = (message: string) => setCart((previous) => ({ ...previous, notice: message }));
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.stringify(items.map(savedCartItem).filter(Boolean));
      if (saved.length > 256_000) throw new Error('Cart storage limit');
      localStorage.setItem(CART_STORAGE_KEY, saved);
    } catch {
      setCart((previous) => ({
        ...previous,
        notice:
          'Your browser cannot save this cart. Items will remain available during this visit.',
      }));
    }
  }, [items]);
  const addToCart = (product: Product, quantity: number = 1, variant?: ProductVariant) => {
    setIsOpen(true);
    if (!savedCartItem({ product, quantity, selectedVariant: variant })) {
      setNotice('This item could not be added. Refresh its product page and check the quantity.');
      return;
    }
    setCart((previous) => {
      const index = previous.items.findIndex(
        (item) =>
          getCartItemKey(item.product.id, item.selectedVariant?.id) ===
          getCartItemKey(product.id, variant?.id)
      );
      if (index >= 0) {
        const combined = previous.items[index].quantity + quantity;
        if (!validCartQuantity(combined))
          return {
            ...previous,
            notice: 'This quantity exceeds the cart limit. Please contact us for a project quote.',
          };
        const next = [...previous.items];
        next[index] = { ...next[index], quantity: combined };
        return { ...previous, items: next };
      }
      if (previous.items.length >= 30)
        return {
          ...previous,
          notice: 'Your cart contains 30 product options. Please contact us for a project quote.',
        };
      return {
        ...previous,
        items: [...previous.items, { product, quantity, selectedVariant: variant }],
      };
    });
  };

  const removeFromCart = (productId: string, variantId?: string) => {
    const key = getCartItemKey(productId, variantId);
    setItems((prev) =>
      prev.filter((item) => getCartItemKey(item.product.id, item.selectedVariant?.id) !== key)
    );
  };

  const updateQuantity = (productId: string, quantity: number, variantId?: string) => {
    if (quantity === 0) {
      removeFromCart(productId, variantId);
      return;
    }

    if (!validCartQuantity(quantity)) {
      setNotice('Enter a whole quantity between 1 and 9,999, or remove the item.');
      return;
    }
    const key = getCartItemKey(productId, variantId);
    setItems((prev) =>
      prev.map((item) =>
        getCartItemKey(item.product.id, item.selectedVariant?.id) === key
          ? { ...item, quantity }
          : item
      )
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const acceptCurrentItem = (productId: string, variantId: string | undefined, product: Product, variant: ProductVariant) => {
    if (product.id !== productId) return;
    setItems(previous => previous.map(item => {
      if (getCartItemKey(item.product.id, item.selectedVariant?.id) !== getCartItemKey(productId, variantId)) return item;
      const saved = item.selectedVariant ?? item.product.variants?.[0];
      if (saved?.id !== variant.id || item.product.fulfillmentProvider !== product.fulfillmentProvider) return item;
      // A legacy line without an explicit selection retains its original option and cart key.
      const updated = item.selectedVariant ? { product, selectedVariant: variant } : {
        product: { ...product, variants: [variant, ...(product.variants ?? []).filter(option => option.id !== variant.id)] },
      };
      return { ...item, ...updated };
    }));
  };

  const openCart = () => setIsOpen(true);
  const closeCart = () => setIsOpen(false);
  const toggleCart = () => setIsOpen((prev) => !prev);

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  // Include variant price adjustments in subtotal
  const subtotal = items.reduce((sum, item) => {
    const basePrice = item.product.price;
    const adjustment = (item.selectedVariant ?? item.product.variants?.[0])?.priceAdjustment || 0;
    return sum + (basePrice + adjustment) * item.quantity;
  }, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        notice,
        addToCart,
        removeFromCart,
        updateQuantity,
        acceptCurrentItem,
        clearCart,
        isOpen,
        openCart,
        closeCart,
        toggleCart,
        itemCount,
        subtotal,
      }}
    >
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
