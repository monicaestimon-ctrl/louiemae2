import React, { useState, useEffect, useRef } from 'react';
import { X, Search, ArrowRight } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { SafeImage } from './SafeImage';

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProductClick: (productId: string) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onProductClick }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const products = useQuery(api.products.list) || [];

    // Filter products based on search term
    const filteredProducts = products.filter(product => {
        const term = searchTerm.toLowerCase();
        return (
            product.name.toLowerCase().includes(term) ||
            product.description.toLowerCase().includes(term) ||
            product.category.toLowerCase().includes(term) ||
            product.collection.toLowerCase().includes(term)
        );
    });

    const handleClose = () => {
        setSearchTerm('');
        onClose();
    };

    // Auto-focus input when modal opens
    useEffect(() => {
        if (!isOpen) return;
        const timer = window.setTimeout(() => inputRef.current?.focus(), 100);
        return () => {
            window.clearTimeout(timer);
            setSearchTerm('');
        };
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    // Lock body scroll when open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    const handleProductClick = (productId: string) => {
        onProductClick(productId);
        handleClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex flex-col backdrop-blur-3xl bg-gradient-to-br from-[#3a2a1a]/95 via-[#2d1f12]/95 to-[#1a130a]/95" role="dialog" aria-modal="true" aria-labelledby="search-modal-title">
            {/* Inner Sheen */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
            
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-6 md:px-12 border-b border-white/10 relative z-10">
                <div className="flex flex-col drop-shadow-md">
                    <span id="search-modal-title" className="font-serif text-3xl text-cream italic tracking-tight">Search</span>
                    <span className="text-[0.55rem] uppercase tracking-[0.3em] text-bronze">Find Products</span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close search"
                    className="group relative w-10 h-10 flex items-center justify-center rounded-full border border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 hover:border-white/40 transition-all duration-300 shadow-lg"
                >
                    <X className="w-5 h-5 text-cream group-hover:rotate-90 transition-transform duration-500" />
                </button>
            </div>

            {/* Search Input */}
            <div className="px-6 md:px-12 py-8 relative z-10">
                <div className="max-w-2xl mx-auto relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-bronze/20 via-white/10 to-bronze/20 rounded-full blur-sm opacity-50 group-focus-within:opacity-100 transition-opacity"></div>
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-cream/50 z-10" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search for furniture, decor, and more..."
                        className="w-full relative bg-white/10 backdrop-blur-xl border border-white/20 rounded-full py-5 pl-14 pr-6 text-cream placeholder:text-cream/40 focus:outline-none focus:border-bronze focus:bg-white/15 transition-all duration-300 font-sans shadow-inner"
                    />
                </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-6 md:px-12 pb-12 relative z-10">
                <div className="max-w-5xl mx-auto">
                    {searchTerm.length === 0 ? (
                        <div className="text-center py-16">
                            <p className="text-cream/50 text-sm font-light tracking-wide">Start typing to search products...</p>
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="text-center py-16">
                            <p className="text-cream/50 text-sm font-light tracking-wide">No products found for "{searchTerm}"</p>
                        </div>
                    ) : (
                        <>
                            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-cream/50 mb-6">
                                {filteredProducts.length} result{filteredProducts.length !== 1 ? 's' : ''} found
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                                {filteredProducts.map(product => (
                                    <button
                                        key={product._id}
                                        onClick={() => handleProductClick(product._id)}
                                        className="group text-left bg-white/5 backdrop-blur-lg rounded-2xl overflow-hidden border border-white/10 hover:border-bronze/40 hover:bg-white/10 hover:-translate-y-1 hover:shadow-[0_15px_30px_rgba(0,0,0,0.3)] transition-all duration-300"
                                    >
                                        <div className="aspect-square overflow-hidden bg-black/20 relative">
                                            {/* Inner glass highlight */}
                                            <div className="absolute inset-0 border border-white/10 pointer-events-none mix-blend-overlay z-10" />
                                            {product.images && product.images[0] ? (
                                                <SafeImage
                                                    src={product.images[0]}
                                                    alt={product.name}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-cream/20 font-light">
                                                    No Image
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-5 flex flex-col h-full bg-gradient-to-t from-black/20 to-transparent">
                                            <h3 className="font-serif text-sm text-cream group-hover:text-bronze transition-colors line-clamp-1 drop-shadow-sm">
                                                {product.name}
                                            </h3>
                                            <p className="text-[0.55rem] uppercase tracking-[0.2em] text-cream/50 mt-1.5">
                                                {product.category}
                                            </p>
                                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                                                <span className="text-bronze font-serif italic text-base">${product.price}</span>
                                                <ArrowRight className="w-4 h-4 text-cream/30 group-hover:text-bronze group-hover:translate-x-1 transition-all duration-300" />
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
