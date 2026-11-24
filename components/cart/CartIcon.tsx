import React from 'react';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '../../contexts/CartContext';

export const CartIcon: React.FC = () => {
  const { toggleCart, itemCount } = useCart();

  return (
    <>
      <button
        onClick={toggleCart}
        className="relative p-2 text-earth hover:text-bronze transition-colors"
        aria-label="Shopping Cart"
      >
        <ShoppingBag className="w-5 h-5" />
        {itemCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 bg-bronze text-cream text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center"
          >
            {itemCount > 99 ? '99+' : itemCount}
          </span>
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {itemCount} {itemCount === 1 ? 'item' : 'items'} in your cart
      </span>
    </>
  );
};

export default CartIcon;
