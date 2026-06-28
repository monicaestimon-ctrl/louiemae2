import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Id } from '../convex/_generated/dataModel';
import {
    Link2, Unlink, ChevronDown, ChevronUp, Package,
    CheckCircle, AlertCircle, Loader2, ArrowRight
} from 'lucide-react';
import { FadeIn } from './FadeIn';
import { SafeImage } from './SafeImage';

interface CjVariant {
    vid: string;
    sku: string;
    name: string;
    price?: number;
    image?: string;
}

interface CjInventorySnapshot {
    vid?: string;
    sku?: string;
    totalInventoryNum?: number;
    status: 'unknown' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'partial' | 'error';
}

interface CustomerVariant {
    id: string;
    name: string;
    image?: string;
    priceAdjustment: number;
    inStock: boolean;
    cjVariantId?: string;
    cjSku?: string;
}

interface ProductWithVariants {
    _id: Id<"products">;
    name: string;
    images: string[];
    variants?: CustomerVariant[];
    cjVariants?: CjVariant[];
    cjInventoryByVariant?: CjInventorySnapshot[];
}

export const CJVariantManager: React.FC<{ targetProductId?: string }> = ({ targetProductId }) => {
    const products = useQuery(api.products.getProductsWithCjVariants) as ProductWithVariants[] | undefined;
    const linkVariant = useMutation(api.products.linkCjVariant);
    const unlinkVariant = useMutation(api.products.unlinkCjVariant);

    const productRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [expandedProduct, setExpandedProduct] = useState<Id<"products"> | null>(null);
    const [linking, setLinking] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        const target = targetProductId as Id<"products"> | undefined;
        if (target) {
            setExpandedProduct(target);
            window.setTimeout(() => {
                productRefs.current.get(target)?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }, 50);
        }
    }, [products, targetProductId]);

    const handleLink = async (
        productId: Id<"products">,
        customerVariantId: string,
        cjVariant: CjVariant
    ) => {
        setLinking(`${customerVariantId}-${cjVariant.vid}`);
        setError(null);
        setSuccess(null);

        try {
            await linkVariant({
                productId,
                customerVariantId,
                cjVariantId: cjVariant.vid,
                cjSku: cjVariant.sku,
            });
            setSuccess(`Linked size to CJ variant`);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err: any) {
            setError(err.message || 'Failed to link variant');
        } finally {
            setLinking(null);
        }
    };

    const handleUnlink = async (productId: Id<"products">, customerVariantId: string) => {
        setLinking(customerVariantId);
        setError(null);

        try {
            await unlinkVariant({ productId, customerVariantId });
            setSuccess(`Removed CJ link`);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err: any) {
            setError(err.message || 'Failed to unlink variant');
        } finally {
            setLinking(null);
        }
    };

    if (products === undefined) {
        return null; // Still loading
    }

    if (products.length === 0) {
        return (
            <FadeIn delay={600}>
                <div className="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-[2rem] p-6 shadow-[0_15px_30px_rgba(0,0,0,0.3)] relative overflow-hidden">
                    <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none z-0"></div>
                    <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none z-0"></div>

                    <div className="flex items-center gap-4 mb-6 relative z-10">
                        <div className="w-12 h-12 rounded-2xl bg-purple-900/20 backdrop-blur-md border border-purple-500/30 flex items-center justify-center shadow-inner">
                            <Link2 className="w-6 h-6 text-purple-400 drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]" />
                        </div>
                        <div>
                            <h3 className="font-serif text-xl text-cream drop-shadow-sm">Size Variant Mapping</h3>
                            <span className="text-[10px] uppercase tracking-widest text-cream/50 mt-1 block">
                                No products with CJ variants
                            </span>
                        </div>
                    </div>
                    <p className="text-sm text-cream/40 text-center py-8 relative z-10 font-serif tracking-wide border border-white/5 bg-white/5 rounded-2xl shadow-inner">
                        When CJ approves products with multiple sizes, they'll appear here for mapping.
                    </p>
                </div>
            </FadeIn>
        );
    }

    return (
        <FadeIn delay={600}>
            <div className="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-[2rem] p-6 md:p-8 shadow-[0_15px_30px_rgba(0,0,0,0.3)] relative overflow-hidden">
                <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none z-0"></div>
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none z-0"></div>

                {/* Header */}
                <div className="flex items-center gap-4 mb-8 relative z-10">
                    <div className="w-12 h-12 rounded-2xl bg-purple-900/20 backdrop-blur-md border border-purple-500/30 flex items-center justify-center shadow-inner">
                        <Link2 className="w-6 h-6 text-purple-400 drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]" />
                    </div>
                    <div>
                        <h3 className="font-serif text-xl text-cream drop-shadow-sm">Size Variant Mapping</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse shadow-[0_0_5px_rgba(192,132,252,0.8)]" />
                            <span className="text-[10px] uppercase tracking-widest text-cream/50 font-medium">
                                {products.length} products with CJ variants
                            </span>
                        </div>
                    </div>
                </div>

                {/* Status Messages */}
                {error && (
                    <div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-2xl flex items-center gap-3 text-sm text-red-400 relative z-10 shadow-inner">
                        <AlertCircle className="w-5 h-5 drop-shadow-[0_0_3px_currentColor]" />
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mb-6 p-4 bg-green-900/20 border border-green-500/30 rounded-2xl flex items-center gap-3 text-sm text-green-400 relative z-10 shadow-inner">
                        <CheckCircle className="w-5 h-5 drop-shadow-[0_0_3px_currentColor]" />
                        {success}
                    </div>
                )}

                {/* Products List */}
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar relative z-10">
                    {products.map((product) => {
                        const isExpanded = expandedProduct === product._id;
                        const isTargeted = targetProductId === product._id;
                        const linkedCount = product.variants?.filter(v => v.cjVariantId).length || 0;
                        const totalVariants = product.variants?.length || 0;
                        const allLinked = linkedCount === totalVariants && totalVariants > 0;
                        const inventoryByVid = new Map((product.cjInventoryByVariant ?? [])
                            .filter(snapshot => snapshot.vid)
                            .map(snapshot => [snapshot.vid, snapshot]));

                        return (
                            <div
                                key={product._id}
                                ref={(node) => {
                                    if (node) {
                                        productRefs.current.set(product._id, node);
                                    } else {
                                        productRefs.current.delete(product._id);
                                    }
                                }}
                                className={`bg-white/5 backdrop-blur-md border rounded-2xl overflow-hidden shadow-inner group transition-all ${isTargeted ? 'border-amber-400/40 ring-1 ring-amber-400/20' : 'border-white/10'}`}
                            >
                                {/* Product Header - Clickable */}
                                <button
                                    onClick={() => setExpandedProduct(isExpanded ? null : product._id)}
                                    className="w-full p-4 flex items-center gap-4 hover:bg-white/10 transition-colors text-left"
                                >
                                    {/* Product Image */}
                                    <div className="w-14 h-14 rounded-xl bg-black/60 border border-white/10 overflow-hidden flex-shrink-0 relative shadow-inner">
                                        {product.images?.[0] ? (
                                            <SafeImage src={product.images[0]} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-cream/20">
                                                <Package className="w-6 h-6" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Product Info */}
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-serif text-base text-cream truncate drop-shadow-sm mb-1">{product.name}</h4>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] uppercase tracking-widest font-medium border px-2 py-0.5 rounded-md ${allLinked ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                                                }`}>
                                                {linkedCount}/{totalVariants} sizes linked
                                            </span>
                                            {allLinked && <CheckCircle className="w-4 h-4 text-green-400 drop-shadow-[0_0_2px_currentColor]" />}
                                        </div>
                                    </div>

                                    {/* Expand Icon */}
                                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/5 transition-colors group-hover:bg-white/10">
                                        {isExpanded ? (
                                            <ChevronUp className="w-4 h-4 text-cream/70" />
                                        ) : (
                                            <ChevronDown className="w-4 h-4 text-cream/70" />
                                        )}
                                    </div>
                                </button>

                                {/* Expanded Variant Mapping */}
                                {isExpanded && (
                                    <div className="p-4 md:p-6 pt-0 space-y-5 border-t border-white/5 bg-black/20">
                                        <div className="pt-4 flex items-center gap-2">
                                            <div className="h-px bg-white/10 flex-1"></div>
                                            <p className="text-[10px] uppercase tracking-widest text-cream/40 px-2 font-medium">Customer Size &rarr; CJ Variant</p>
                                            <div className="h-px bg-white/10 flex-1"></div>
                                        </div>

                                        {/* Customer Variants (Sizes) */}
                                        {product.variants?.map((customerVar) => (
                                            <div
                                                key={customerVar.id}
                                                className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner"
                                            >
                                                <div className="flex items-center justify-between mb-4">
                                                    <span className="font-serif text-base text-cream drop-shadow-sm">
                                                        {customerVar.name}
                                                    </span>
                                                    {customerVar.cjVariantId && (
                                                        <button
                                                            onClick={() => handleUnlink(product._id, customerVar.id)}
                                                            disabled={linking === customerVar.id}
                                                            className="text-[11px] uppercase tracking-widest font-medium text-red-400 hover:text-red-300 active:text-red-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/30 transition-colors border border-red-500/30 shadow-inner"
                                                        >
                                                            {linking === customerVar.id ? (
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            ) : (
                                                                <Unlink className="w-3.5 h-3.5" />
                                                            )}
                                                            Unlink
                                                        </button>
                                                    )}
                                                </div>

                                                {customerVar.cjVariantId ? (
                                                    // Show linked CJ variant
                                                    <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-3 flex items-center gap-3 shadow-inner">
                                                        <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 drop-shadow-[0_0_3px_currentColor]" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm text-green-400 font-medium truncate drop-shadow-sm">
                                                                {product.cjVariants?.find(v => v.vid === customerVar.cjVariantId)?.name || customerVar.cjVariantId}
                                                            </p>
                                                            <p className="text-[11px] text-green-400/60 font-mono mt-0.5">
                                                                SKU: {customerVar.cjSku || 'N/A'}
                                                                {inventoryByVid.get(customerVar.cjVariantId)?.totalInventoryNum !== undefined
                                                                    ? ` • ${inventoryByVid.get(customerVar.cjVariantId)?.totalInventoryNum} in CJ`
                                                                    : ''}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    // Show CJ variants to choose from
                                                    <div className="flex flex-wrap gap-2 mt-2">
                                                        {product.cjVariants?.map((cjVar) => {
                                                            const isAlreadyLinked = product.variants?.some(
                                                                v => v.cjVariantId === cjVar.vid && v.id !== customerVar.id
                                                            );
                                                            const isLinking = linking === `${customerVar.id}-${cjVar.vid}`;

                                                            return (
                                                                <button
                                                                    key={cjVar.vid}
                                                                    onClick={() => handleLink(product._id, customerVar.id, cjVar)}
                                                                    disabled={isAlreadyLinked || isLinking}
                                                                    className={`
                                                                        text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-2 active:scale-[0.98]
                                                                        ${isAlreadyLinked
                                                                            ? 'bg-white/5 text-white/20 border border-transparent cursor-not-allowed hidden'
                                                                            : 'bg-white/10 text-cream border border-white/20 hover:bg-purple-500/20 hover:border-purple-500/40 hover:text-purple-300 shadow-inner hover:shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                                                                        }
                                                                    `}
                                                                    title={isAlreadyLinked ? 'Already linked to another size' : `Link to ${cjVar.name}`}
                                                                >
                                                                    {!isAlreadyLinked && (
                                                                        <>
                                                                            {isLinking ? (
                                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                                            ) : (
                                                                                <ArrowRight className="w-4 h-4 opacity-70" />
                                                                            )}
                                                                            {cjVar.name}
                                                                        </>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                        {product.cjVariants?.every(cjVar => product.variants?.some(v => v.cjVariantId === cjVar.vid && v.id !== customerVar.id)) && (
                                                            <span className="text-[11px] text-cream/40 italic py-2">All available CJ sizes have been mapped to other variants.</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}

                                        {/* CJ Variants reference */}
                                        <div className="mt-6 pt-6 border-t border-white/5">
                                            <p className="text-[10px] uppercase tracking-widest text-cream/40 mb-3 font-medium">
                                                Available CJ Variants ({product.cjVariants?.length || 0})
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                {product.cjVariants?.map(v => (
                                                    <span
                                                        key={v.vid}
                                                        className="text-[10px] bg-white/5 border border-white/10 px-2.5 py-1 rounded-md text-cream/60 font-mono shadow-inner"
                                                    >
                                                        {v.name}
                                                        {inventoryByVid.get(v.vid)?.totalInventoryNum !== undefined
                                                            ? ` • ${inventoryByVid.get(v.vid)?.totalInventoryNum} in CJ`
                                                            : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </FadeIn>
    );
};

export default CJVariantManager;
