import React, { useState, useEffect, useRef } from 'react';
import { X, Search, ArrowRight } from 'lucide-react';
import { useRecoverableQuery } from '../contexts/useRecoverableQuery';
import { api } from '../convex/_generated/api';
import { SafeImage } from './SafeImage';
import { navigatePlainLink } from '../lib/navigation';
import { productUrl } from '../lib/storefrontNavigation';
import { PaginatedSearchResults } from './PaginatedSearchResults';

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProductClick: (productId: string, term: string) => void;
    initialTerm?: string;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onProductClick, initialTerm = '' }) => {
    const [searchTerm, setSearchTerm] = useState(initialTerm);
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(initialTerm);
    const inputRef = useRef<HTMLInputElement>(null);
    const normalizedSearchTerm = searchTerm.trim();
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearchTerm(normalizedSearchTerm), 250);
        return () => window.clearTimeout(timer);
    }, [normalizedSearchTerm]);
    const readiness = useRecoverableQuery(api.publicSearch.status, isOpen ? {} : 'skip');
    const unified = readiness.data?.ready === true;
    const search = useRecoverableQuery(
        api.products.searchStorefront,
        isOpen && !unified && debouncedSearchTerm.length >= 2
            ? { term: debouncedSearchTerm, limit: 20 }
            : 'skip',
    );
    const isSearching = normalizedSearchTerm.length >= 2
        && (debouncedSearchTerm !== normalizedSearchTerm || search.status === 'loading');
    const results = search.data ?? [];
    const searchUnavailable = debouncedSearchTerm === normalizedSearchTerm && search.status === 'unavailable';

    const handleClose = () => {
        setSearchTerm('');
        setDebouncedSearchTerm('');
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

    const handleProductClick = (productId: string) => {
        onProductClick(productId, normalizedSearchTerm);
        handleClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex flex-col backdrop-blur-3xl bg-gradient-to-br from-[#3a2a1a]/95 via-[#2d1f12]/95 to-[#1a130a]/95">
            {/* Inner Sheen */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
            
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-6 md:px-12 border-b border-white/10 relative z-10">
                <div className="flex flex-col drop-shadow-md">
                    <span id="search-modal-title" className="font-serif text-3xl text-cream italic tracking-tight">Search</span>
                    <span className="text-[0.55rem] uppercase tracking-[0.3em] text-[#D6B99C]">Find Products</span>
                </div>
                <button
                    type="button"
                    onClick={handleClose}
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
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-cream z-10" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search for furniture, decor, and more..."
                        aria-label="Search products"
                        className="w-full relative bg-white/10 backdrop-blur-xl border border-white/20 rounded-full py-5 pl-14 pr-6 text-cream placeholder-readable-light focus:outline-none focus:border-bronze focus:bg-white/15 transition-all duration-300 font-sans shadow-inner"
                    />
                </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-6 md:px-12 pb-12 relative z-10">
                <div className="max-w-5xl mx-auto">
                    {normalizedSearchTerm.length < 2 ? (
                        <div className="text-center py-16">
                            <p className="text-muted-cream text-sm font-light tracking-wide">Type at least two characters to search products...</p>
                        </div>
                    ) : unified && normalizedSearchTerm === debouncedSearchTerm ? (
                        <PaginatedSearchResults key={debouncedSearchTerm} term={debouncedSearchTerm} onSelect={handleProductClick} />
                    ) : searchUnavailable ? (
                        <div role="status" className="text-center py-16 text-cream">
                            <p>Search is temporarily unavailable. Your search has been kept.</p>
                            <button className="mt-4 min-h-11 border border-cream px-5 py-3" onClick={search.retry}>Try again</button>
                        </div>
                    ) : isSearching ? (
                        <div className="text-center py-16">
                            <p className="text-muted-cream text-sm font-light tracking-wide">Searching...</p>
                        </div>
                    ) : results.length === 0 ? (
                        <div className="text-center py-16">
                            <p role="status" className="text-muted-cream text-sm font-light tracking-wide">No products found for "{searchTerm}"</p>
                        </div>
                    ) : (
                        <>
                            <p role="status" className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-cream mb-6">
                                {results.length} result{results.length !== 1 ? 's' : ''} found
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                                {results.map(product => (
                                    <a
                                        key={product._id}
                                        href={productUrl(product._id)}
                                        onClick={event => navigatePlainLink(event, productUrl(product._id), () => handleProductClick(product._id))}
                                        className="group text-left bg-white/5 backdrop-blur-lg rounded-2xl overflow-hidden border border-white/10 hover:border-bronze/40 hover:bg-white/10 hover:-translate-y-1 hover:shadow-[0_15px_30px_rgba(0,0,0,0.3)] transition-all duration-300"
                                    >
                                        <div className="aspect-square overflow-hidden bg-black/20 relative">
                                            {/* Inner glass highlight */}
                                            <div className="absolute inset-0 border border-white/10 pointer-events-none mix-blend-overlay z-10" />
                                            {product.images && product.images[0] ? (
                                                <SafeImage
                                                    src={product.images[0]}
                                                    alt={product.name}
                                                    className="w-full h-full object-contain"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-muted-cream font-light">
                                                    No Image
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-4 flex flex-col bg-gradient-to-t from-black/20 to-transparent">
                                            <h3 className="font-serif text-sm text-cream group-hover:text-[#D6B99C] transition-colors line-clamp-2 drop-shadow-sm">
                                                {product.name}
                                            </h3>
                                            <p className="text-[0.55rem] uppercase tracking-[0.2em] text-muted-cream mt-1.5">
                                                {product.category}
                                            </p>
                                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                                                <span className="text-[#D6B99C] font-serif italic text-base">${product.price}</span>
                                                <ArrowRight className="w-4 h-4 text-muted-cream group-hover:text-[#D6B99C] group-hover:translate-x-1 transition-all duration-300" />
                                            </div>
                                        </div>
                                    </a>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
