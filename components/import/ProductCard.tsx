import React from 'react';
import { Star, Wand2, ExternalLink, Check } from 'lucide-react';
import { AliExpressProduct } from '../../services/aliexpressService';
import { CollectionType } from '../../types';
import { FadeIn } from '../FadeIn';

export interface ImportableProduct extends AliExpressProduct {
    selected: boolean;
    customName?: string;
    customPrice?: number;
    customDescription?: string;
    targetCollection?: CollectionType;
    targetSubcategory?: string;
    isEnhancing?: boolean;
    selectedImages?: number[]; // Indices of selected images for import
    imageOrder?: number[]; // Custom ordering of selectedImages — position 0 = main listing image
    selectedVariants?: string[]; // IDs of selected variants for import
    originalVariants?: Array<{ id: string; name: string; image?: string }>; // Snapshot of variant state (post-translation) for revert
    variantImageMap?: Record<string, number>; // Maps variant ID → image index for variant-specific images
    descriptionImages?: string[]; // Marketing/description images from 1688 GetItemDescription
    sourceCurrency?: string; // Original currency code (e.g. 'CNY', 'USD') for audit trail
    sourcePriceOriginal?: number; // Original price in source currency for audit trail
    sourcePriceCny?: number; // Upstream CNY price for two-stage pricing
    descriptionAuditId?: string;
    smartDescriptionAdminEdited?: boolean;
    smartDescriptionWarnings?: string[];
    smartDescriptionSourceQuality?: number;
    smartDescriptionFallbackUsed?: boolean;
}

interface ProductCardProps {
    product: ImportableProduct;
    index: number;
    calculateFinalPrice: (price: number) => number;
    toggleProductSelection: (productId: string) => void;
    updateProductField: (productId: string, field: keyof ImportableProduct, value: any) => void;
    enhanceProductWithAI: (productId: string) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
    product,
    index,
    calculateFinalPrice,
    toggleProductSelection,
    updateProductField,
    enhanceProductWithAI,
}) => {
    return (
        <FadeIn delay={index * 50}>
            <div
                className={`glass-card rounded-2xl overflow-hidden transition-all duration-500 relative group bg-white
                    ${product.selected ? 'ring-4 ring-cream/80 scale-[1.02] shadow-xl' : 'hover:scale-[1.01] hover:shadow-xl hover:ring-2 hover:ring-cream/50'}
                `}
            >
                {/* Action Overlay (Glass) */}
                <div className="absolute inset-0 bg-earth/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 flex flex-col justify-center items-center gap-3">
                    <button
                        onClick={() => toggleProductSelection(product.id)}
                        className={`px-8 py-3 rounded-full text-xs uppercase tracking-widest font-bold transition-all transform hover:scale-105 shadow-lg ${product.selected ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-cream text-earth hover:bg-white'}`}
                    >
                        {product.selected ? 'Deselect' : 'Select Product'}
                    </button>
                    <div className="flex gap-2">
                        <button
                            onClick={(e) => { e.stopPropagation(); enhanceProductWithAI(product.id); }}
                            className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-purple-600 hover:text-purple-700 shadow-md hover:scale-110 transition-transform"
                            title="Smart Enhance"
                        >
                            <Wand2 className="w-5 h-5" />
                        </button>
                        {product.productUrl && (
                            <a
                                href={product.productUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-earth hover:text-bronze shadow-md hover:scale-110 transition-transform"
                            >
                                <ExternalLink className="w-5 h-5" />
                            </a>
                        )}
                    </div>
                </div>

                {/* Visible Content */}
                <div className="relative">
                    <div className="h-72 overflow-hidden bg-cream/10">
                        <img
                            src={product.images[0] || 'https://via.placeholder.com/160'}
                            alt={product.name}
                            referrerPolicy="no-referrer"
                            crossOrigin="anonymous"
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                        />
                    </div>

                    {/* Status Badge */}
                    {product.selected && (
                        <div className="absolute top-4 right-4 bg-bronze text-white px-3 py-1 rounded-full text-[10px] uppercase tracking-widest shadow-lg animate-bounce">
                            Selected
                        </div>
                    )}
                </div>

                <div className="p-6 relative z-0 bg-white">
                    {product.selected ? (
                        <div className="mb-4 space-y-2">
                            <input
                                type="text"
                                value={product.customName || product.name}
                                onChange={(e) => updateProductField(product.id, 'customName', e.target.value)}
                                className="w-full bg-transparent border-b border-earth/20 focus:border-bronze font-serif text-lg text-earth pb-1 focus:outline-none font-medium"
                                placeholder="Product Name"
                            />
                        </div>
                    ) : (
                        <h3 className="font-serif text-xl text-earth mb-2 line-clamp-2 leading-tight font-medium">
                            {product.name}
                        </h3>
                    )}

                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-earth/5">
                        <div className="flex flex-col">
                            <span className="text-[9px] uppercase tracking-widest text-earth/50 font-bold">Price</span>
                            <span className="font-serif text-2xl text-bronze font-bold">
                                ${(product.customPrice || calculateFinalPrice(product.salePrice || product.price)).toFixed(2)}
                            </span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[9px] uppercase tracking-widest text-earth/50 font-bold">Cost</span>
                            <span className="text-sm text-earth/40 line-through font-medium">
                                ${(product.salePrice || product.price).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-xs text-earth/60">
                        <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-bronze fill-bronze" />
                            <span className="font-medium">{product.averageRating.toFixed(1)}</span>
                        </div>
                        <div className="bg-earth/5 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider font-semibold text-earth/60">
                            {product.category || 'Item'}
                        </div>
                    </div>
                </div>
            </div>
        </FadeIn>
    );
};

export default ProductCard;
