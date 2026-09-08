import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
    AlertCircle,
    ArrowRight,
    Check,
    CheckCircle,
    ChevronDown,
    ChevronUp,
    Edit3,
    ExternalLink,
    Link2,
    Loader2,
    Package,
    Plus,
    Save,
    Search,
    Sparkles,
    Trash2,
    Unlink,
} from 'lucide-react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { getUserFacingErrorMessage } from '../lib/errorMessages';
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

interface MappingSummary {
    issueCodes: string[];
    customerVariantCount: number;
    mappedVariantCount: number;
    unmappedVariantCount: number;
    cjVariantCount: number;
    unmatchedCjVariantCount: number;
    invalidMappingCount: number;
}

interface ProductWithVariants {
    _id: Id<'products'>;
    name: string;
    images: string[];
    sourceUrl?: string;
    cjProductId?: string;
    cjSourcingStatus?: string;
    cjSourcingState?: string;
    cjFulfillmentReadiness?: string;
    productRevision?: number;
    variants?: CustomerVariant[];
    cjVariants?: CjVariant[];
    cjInventoryByVariant?: CjInventorySnapshot[];
    mappingSummary: MappingSummary;
}

type QueueFilter = 'needs_attention' | 'unmapped' | 'missing_customer' | 'missing_cj' | 'ready' | 'all';

type CJVariantManagerProps = {
    targetProductId?: string;
    onEditProduct?: (productId: string) => void;
};

const FILTERS: Array<{ key: QueueFilter; label: string }> = [
    { key: 'needs_attention', label: 'Needs attention' },
    { key: 'unmapped', label: 'Needs mapping' },
    { key: 'missing_customer', label: 'Missing customer variants' },
    { key: 'missing_cj', label: 'Missing CJ variants' },
    { key: 'ready', label: 'Ready' },
    { key: 'all', label: 'All CJ products' },
];

const ISSUE_LABELS: Record<string, string> = {
    MISSING_CJ_PRODUCT_ID: 'Missing CJ product ID',
    MISSING_CJ_VARIANTS: 'No CJ variants returned',
    MISSING_CUSTOMER_VARIANTS: 'Customer variants need to be created',
    UNMAPPED_CUSTOMER_VARIANTS: 'Customer variants need mapping',
    INVALID_CJ_MAPPINGS: 'Saved mappings no longer match CJ',
    DUPLICATE_CJ_MAPPINGS: 'One CJ variant is mapped more than once',
    RECONCILIATION_REQUIRED: 'CJ reconciliation required',
    NEEDS_INPUT: 'CJ needs more product information',
    READY: 'Fulfillment ready',
};

const normalizeVariantLabel = (value: string): string =>
    value
        .toLowerCase()
        .normalize('NFKC')
        .replace(/\b(size|color|colour|style|option)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const cloneVariants = (variants?: CustomerVariant[]): CustomerVariant[] =>
    (variants ?? []).map((variant) => ({ ...variant }));

const createVariantId = (): string => {
    if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
        return 'variant_' + globalThis.crypto.randomUUID();
    }
    return 'variant_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
};

const matchesFilter = (product: ProductWithVariants, filter: QueueFilter): boolean => {
    const issues = product.mappingSummary.issueCodes;
    if (filter === 'all') return true;
    if (filter === 'ready') return issues.includes('READY');
    if (filter === 'needs_attention') return !issues.includes('READY');
    if (filter === 'unmapped') {
        return issues.some((code) => ['UNMAPPED_CUSTOMER_VARIANTS', 'INVALID_CJ_MAPPINGS', 'DUPLICATE_CJ_MAPPINGS'].includes(code));
    }
    if (filter === 'missing_customer') return issues.includes('MISSING_CUSTOMER_VARIANTS');
    return issues.includes('MISSING_CJ_VARIANTS');
};

export const CJVariantManager: React.FC<CJVariantManagerProps> = ({ targetProductId, onEditProduct }) => {
    const products = useQuery(api.products.getProductsWithCjVariants, {}) as ProductWithVariants[] | undefined;
    const saveVariantWorkspace = useMutation(api.products.saveVariantWorkspace);
    const productRefs = useRef<Map<string, HTMLElement>>(new Map());
    const [expandedProduct, setExpandedProduct] = useState<Id<'products'> | null>(null);
    const [drafts, setDrafts] = useState<Record<string, CustomerVariant[]>>({});
    const [dirtyProducts, setDirtyProducts] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<QueueFilter>('needs_attention');
    const [search, setSearch] = useState('');
    const [savingProduct, setSavingProduct] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        if (!products) return;
        setDrafts((current) => {
            const next = { ...current };
            for (const product of products) {
                if (!dirtyProducts.has(product._id)) {
                    next[product._id] = cloneVariants(product.variants);
                }
            }
            return next;
        });
    }, [products, dirtyProducts]);

    useEffect(() => {
        const target = targetProductId as Id<'products'> | undefined;
        if (!target || !products) return;
        setExpandedProduct(target);
        window.setTimeout(() => {
            productRefs.current.get(target)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }, 50);
    }, [products, targetProductId]);

    const counts = useMemo(() => {
        const rows = products ?? [];
        return {
            all: rows.length,
            needs_attention: rows.filter((product) => matchesFilter(product, 'needs_attention')).length,
            unmapped: rows.filter((product) => matchesFilter(product, 'unmapped')).length,
            missing_customer: rows.filter((product) => matchesFilter(product, 'missing_customer')).length,
            missing_cj: rows.filter((product) => matchesFilter(product, 'missing_cj')).length,
            ready: rows.filter((product) => matchesFilter(product, 'ready')).length,
        };
    }, [products]);

    const visibleProducts = useMemo(() => {
        const query = search.trim().toLowerCase();
        const rows = (products ?? []).filter((product) => {
            if (targetProductId === product._id) return true;
            if (!matchesFilter(product, filter)) return false;
            if (!query) return true;
            return [
                product.name,
                product.cjProductId,
                product.sourceUrl,
                ...(product.variants ?? []).flatMap((variant) => [variant.name, variant.cjSku, variant.cjVariantId]),
                ...(product.cjVariants ?? []).flatMap((variant) => [variant.name, variant.sku, variant.vid]),
            ].some((value) => value?.toLowerCase().includes(query));
        });
        if (!targetProductId) return rows;
        return [...rows].sort((left, right) => Number(right._id === targetProductId) - Number(left._id === targetProductId));
    }, [filter, products, search, targetProductId]);

    const updateDraft = (productId: string, updater: (variants: CustomerVariant[]) => CustomerVariant[]) => {
        setDrafts((current) => ({
            ...current,
            [productId]: updater(cloneVariants(current[productId])),
        }));
        setDirtyProducts((current) => new Set(current).add(productId));
        setError(null);
        setSuccess(null);
    };

    const addCustomerVariant = (product: ProductWithVariants, cjVariant?: CjVariant) => {
        const usedLabels = new Set((drafts[product._id] ?? []).map((variant) => normalizeVariantLabel(variant.name)));
        let label = cjVariant?.name?.trim() || 'New option';
        if (usedLabels.has(normalizeVariantLabel(label))) {
            label = label + ' ' + ((drafts[product._id]?.length ?? 0) + 1);
        }
        updateDraft(product._id, (variants) => [
            ...variants,
            {
                id: createVariantId(),
                name: label,
                image: cjVariant?.image || product.images?.[0],
                priceAdjustment: 0,
                inStock: true,
                cjVariantId: cjVariant?.vid,
                cjSku: cjVariant?.sku,
            },
        ]);
    };

    const applyRecommendedMappings = (product: ProductWithVariants) => {
        const providerVariants = product.cjVariants ?? [];
        updateDraft(product._id, (variants) => {
            const used = new Set(variants.map((variant) => variant.cjVariantId).filter(Boolean));
            let applied = 0;
            const next = variants.map((variant) => {
                if (variant.cjVariantId) return variant;
                const customerKey = normalizeVariantLabel(variant.name);
                const candidates = providerVariants.filter((provider) => {
                    if (used.has(provider.vid)) return false;
                    const providerKey = normalizeVariantLabel(provider.name);
                    return providerKey === customerKey || providerKey.endsWith(' ' + customerKey) || customerKey.endsWith(' ' + providerKey);
                });
                if (candidates.length !== 1) return variant;
                used.add(candidates[0].vid);
                applied += 1;
                return { ...variant, cjVariantId: candidates[0].vid, cjSku: candidates[0].sku };
            });
            if (applied === 0) {
                setSuccess('No exact, conflict-free matches were found. Review the variants manually.');
                return variants;
            }
            setSuccess('Applied ' + applied + ' exact mapping recommendation' + (applied === 1 ? '.' : 's.'));
            return next;
        });
    };

    const saveProduct = async (product: ProductWithVariants) => {
        setSavingProduct(product._id);
        setError(null);
        setSuccess(null);
        try {
            const result = await saveVariantWorkspace({
                productId: product._id,
                expectedRevision: product.productRevision ?? 0,
                variants: drafts[product._id] ?? [],
            });
            setDirtyProducts((current) => {
                const next = new Set(current);
                next.delete(product._id);
                return next;
            });
            setSuccess(
                result.mappingComplete
                    ? 'Saved. This product is now fully mapped.'
                    : 'Saved. Remaining mapping issues are shown below.'
            );
        } catch (caught) {
            setError(getUserFacingErrorMessage(caught, 'The variant workspace could not be saved.'));
        } finally {
            setSavingProduct(null);
        }
    };

    if (products === undefined) {
        return (
            <div className="rounded-[2rem] border border-white/10 bg-black/40 p-10 text-center text-cream/50">
                <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-purple-300" />
                Loading the product resolution queue…
            </div>
        );
    }

    return (
        <FadeIn delay={150}>
            <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/40 p-5 shadow-[0_15px_30px_rgba(0,0,0,0.3)] backdrop-blur-2xl md:p-8">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/5 to-transparent" />
                <div className="relative z-10">
                    <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-900/20">
                                <Link2 className="h-6 w-6 text-purple-300" />
                            </div>
                            <div>
                                <h3 className="font-serif text-2xl text-cream">Product Resolution Queue</h3>
                                <p className="mt-1 text-sm text-cream/50">
                                    Edit customer variants and attach the exact CJ variants without leaving this dashboard.
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2">
                                <strong className="block text-lg text-amber-200">{counts.needs_attention}</strong>
                                <span className="text-[9px] uppercase tracking-widest text-amber-200/60">Need help</span>
                            </div>
                            <div className="rounded-xl border border-purple-400/20 bg-purple-500/10 px-3 py-2">
                                <strong className="block text-lg text-purple-200">{counts.unmapped}</strong>
                                <span className="text-[9px] uppercase tracking-widest text-purple-200/60">Mapping</span>
                            </div>
                            <div className="rounded-xl border border-green-400/20 bg-green-500/10 px-3 py-2">
                                <strong className="block text-lg text-green-200">{counts.ready}</strong>
                                <span className="text-[9px] uppercase tracking-widest text-green-200/60">Ready</span>
                            </div>
                        </div>
                    </div>

                    <div className="mb-5 flex flex-col gap-3">
                        <label className="relative block">
                            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cream/30" />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search product, SKU, VID, CJ product ID, or source URL"
                                className="w-full rounded-xl border border-white/10 bg-black/30 py-3 pl-11 pr-4 text-sm text-cream outline-none placeholder:text-cream/25 focus:border-purple-400/40"
                            />
                        </label>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {FILTERS.map((option) => {
                                const count = counts[option.key];
                                const active = filter === option.key;
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onClick={() => setFilter(option.key)}
                                        className={
                                            'whitespace-nowrap rounded-full border px-3 py-2 text-[10px] uppercase tracking-widest transition-colors ' +
                                            (active
                                                ? 'border-purple-300/40 bg-purple-500/20 text-purple-100'
                                                : 'border-white/10 bg-white/5 text-cream/50 hover:bg-white/10 hover:text-cream')
                                        }
                                    >
                                        {option.label} · {count}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {error && (
                        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-900/20 p-4 text-sm text-red-300">
                            <AlertCircle className="h-5 w-5 shrink-0" />
                            {error}
                        </div>
                    )}
                    {success && (
                        <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-900/20 p-4 text-sm text-green-300">
                            <CheckCircle className="h-5 w-5 shrink-0" />
                            {success}
                        </div>
                    )}

                    <div className="max-h-[760px] space-y-4 overflow-y-auto pr-1 custom-scrollbar">
                        {visibleProducts.length === 0 && (
                            <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-12 text-center text-sm text-cream/45">
                                No products match this queue view.
                            </div>
                        )}

                        {visibleProducts.map((product) => {
                            const isExpanded = expandedProduct === product._id;
                            const isTargeted = targetProductId === product._id;
                            const variants = drafts[product._id] ?? cloneVariants(product.variants);
                            const providerVariants = product.cjVariants ?? [];
                            const mappedCount = variants.filter((variant) => variant.cjVariantId && variant.cjSku).length;
                            const usedProviderIds = new Set(variants.map((variant) => variant.cjVariantId).filter(Boolean));
                            const unmatchedProviderVariants = providerVariants.filter((variant) => !usedProviderIds.has(variant.vid));
                            const inventoryByVid = new Map(
                                (product.cjInventoryByVariant ?? [])
                                    .filter((snapshot) => snapshot.vid)
                                    .map((snapshot) => [snapshot.vid as string, snapshot])
                            );
                            const isDirty = dirtyProducts.has(product._id);

                            return (
                                <article
                                    key={product._id}
                                    ref={(node) => {
                                        if (node) productRefs.current.set(product._id, node);
                                        else productRefs.current.delete(product._id);
                                    }}
                                    className={
                                        'overflow-hidden rounded-2xl border bg-white/5 shadow-inner transition-all ' +
                                        (isTargeted ? 'border-amber-300/50 ring-1 ring-amber-300/20' : 'border-white/10')
                                    }
                                >
                                    <button
                                        type="button"
                                        onClick={() => setExpandedProduct(isExpanded ? null : product._id)}
                                        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-white/5"
                                    >
                                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/50">
                                            {product.images?.[0] ? (
                                                <SafeImage src={product.images[0]} alt="" className="h-full w-full object-cover" />
                                            ) : (
                                                <span className="flex h-full w-full items-center justify-center"><Package className="h-6 w-6 text-cream/20" /></span>
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h4 className="truncate font-serif text-base text-cream">{product.name}</h4>
                                                {isDirty && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-amber-200">Unsaved</span>}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest">
                                                <span className={mappedCount === variants.length && variants.length > 0 ? 'text-green-300' : 'text-amber-300'}>
                                                    {mappedCount}/{variants.length} customer variants mapped
                                                </span>
                                                <span className="text-cream/35">· {providerVariants.length} CJ variants</span>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {product.mappingSummary.issueCodes.slice(0, 3).map((code) => (
                                                    <span
                                                        key={code}
                                                        className={
                                                            'rounded-md border px-2 py-1 text-[9px] uppercase tracking-wider ' +
                                                            (code === 'READY'
                                                                ? 'border-green-400/20 bg-green-500/10 text-green-200'
                                                                : 'border-amber-400/20 bg-amber-500/10 text-amber-200')
                                                        }
                                                    >
                                                        {ISSUE_LABELS[code] || code}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5">
                                            {isExpanded ? <ChevronUp className="h-4 w-4 text-cream/60" /> : <ChevronDown className="h-4 w-4 text-cream/60" />}
                                        </span>
                                    </button>

                                    {isExpanded && (
                                        <div className="border-t border-white/10 bg-black/20 p-4 md:p-6">
                                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-[0.18em] text-cream/35">Quick Fix Workspace</p>
                                                    <p className="mt-1 text-sm text-cream/55">Edit the customer option, then choose the CJ variant that should fulfill it.</p>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {product.sourceUrl && (
                                                        <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-widest text-cream/60 hover:text-cream">
                                                            <ExternalLink className="h-3.5 w-3.5" /> Source
                                                        </a>
                                                    )}
                                                    {onEditProduct && (
                                                        <button type="button" onClick={() => onEditProduct(product._id)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-widest text-cream/70 hover:bg-white/10 hover:text-cream">
                                                            <Edit3 className="h-3.5 w-3.5" /> Full product edit
                                                        </button>
                                                    )}
                                                    <button type="button" onClick={() => applyRecommendedMappings(product)} disabled={providerVariants.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-purple-400/25 bg-purple-500/10 px-3 py-2 text-[10px] uppercase tracking-widest text-purple-200 disabled:opacity-40">
                                                        <Sparkles className="h-3.5 w-3.5" /> Apply exact matches
                                                    </button>
                                                    <button type="button" onClick={() => addCustomerVariant(product)} className="inline-flex items-center gap-1.5 rounded-lg border border-bronze/30 bg-bronze/10 px-3 py-2 text-[10px] uppercase tracking-widest text-bronze hover:bg-bronze/20">
                                                        <Plus className="h-3.5 w-3.5" /> Add customer variant
                                                    </button>
                                                </div>
                                            </div>

                                            {providerVariants.length === 0 && (
                                                <div className="mb-5 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                                                    <div className="flex items-start gap-3">
                                                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                                                        <div>
                                                            <strong className="font-medium">CJ has not returned variants for this product.</strong>
                                                            <p className="mt-1 text-amber-100/65">
                                                                This product remains visible here so you can correct its customer variants or open the full editor. Refresh or resubmit CJ data from the sourcing controls above when appropriate.
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-3">
                                                {variants.length === 0 && (
                                                    <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-cream/45">
                                                        No customer variants are listed. Add one manually or create one from a CJ variant below.
                                                    </div>
                                                )}

                                                {variants.map((variant, index) => {
                                                    const mappedProvider = providerVariants.find((provider) => provider.vid === variant.cjVariantId);
                                                    const inventory = mappedProvider ? inventoryByVid.get(mappedProvider.vid) : undefined;
                                                    return (
                                                        <div key={variant.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                                <span className="text-[10px] uppercase tracking-widest text-cream/35">Customer variant {index + 1}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (variant.cjVariantId && !confirm('Remove this mapped customer variant? Customers will no longer be able to select it.')) return;
                                                                        updateDraft(product._id, (current) => current.filter((item) => item.id !== variant.id));
                                                                    }}
                                                                    aria-label={'Remove ' + variant.name}
                                                                    className="rounded-lg border border-red-400/20 bg-red-500/10 p-2 text-red-300 hover:bg-red-500/20"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1fr_110px_130px]">
                                                                <label className="block">
                                                                    <span className="mb-1.5 block text-[9px] uppercase tracking-widest text-cream/35">Customer-facing label</span>
                                                                    <input
                                                                        value={variant.name}
                                                                        onChange={(event) => updateDraft(product._id, (current) => current.map((item) => item.id === variant.id ? { ...item, name: event.target.value } : item))}
                                                                        className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-cream outline-none focus:border-bronze/60"
                                                                    />
                                                                </label>
                                                                <label className="block">
                                                                    <span className="mb-1.5 block text-[9px] uppercase tracking-widest text-cream/35">Variant image URL</span>
                                                                    <input
                                                                        value={variant.image || ''}
                                                                        onChange={(event) => updateDraft(product._id, (current) => current.map((item) => item.id === variant.id ? { ...item, image: event.target.value || undefined } : item))}
                                                                        placeholder="Use main product image"
                                                                        className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-cream outline-none placeholder:text-cream/20 focus:border-bronze/60"
                                                                    />
                                                                </label>
                                                                <label className="block">
                                                                    <span className="mb-1.5 block text-[9px] uppercase tracking-widest text-cream/35">Price +/-</span>
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={variant.priceAdjustment}
                                                                        onChange={(event) => updateDraft(product._id, (current) => current.map((item) => item.id === variant.id ? { ...item, priceAdjustment: Number(event.target.value) || 0 } : item))}
                                                                        className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-cream outline-none focus:border-bronze/60"
                                                                    />
                                                                </label>
                                                                <label className="block">
                                                                    <span className="mb-1.5 block text-[9px] uppercase tracking-widest text-cream/35">Availability</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => updateDraft(product._id, (current) => current.map((item) => item.id === variant.id ? { ...item, inStock: !item.inStock } : item))}
                                                                        className={
                                                                            'w-full rounded-lg border px-3 py-2.5 text-[10px] uppercase tracking-widest ' +
                                                                            (variant.inStock
                                                                                ? 'border-green-400/25 bg-green-500/10 text-green-200'
                                                                                : 'border-white/10 bg-white/5 text-cream/40')
                                                                        }
                                                                    >
                                                                        {variant.inStock ? 'Sellable' : 'Hidden'}
                                                                    </button>
                                                                </label>
                                                            </div>
                                                            <div className="mt-3 grid grid-cols-1 items-end gap-3 lg:grid-cols-[1fr_auto]">
                                                                <label className="block">
                                                                    <span className="mb-1.5 block text-[9px] uppercase tracking-widest text-cream/35">CJ fulfillment variant</span>
                                                                    <select
                                                                        value={variant.cjVariantId || ''}
                                                                        onChange={(event) => {
                                                                            const provider = providerVariants.find((item) => item.vid === event.target.value);
                                                                            updateDraft(product._id, (current) => current.map((item) => item.id === variant.id
                                                                                ? { ...item, cjVariantId: provider?.vid, cjSku: provider?.sku }
                                                                                : item));
                                                                        }}
                                                                        className="w-full rounded-lg border border-white/10 bg-[#171512] px-3 py-2.5 text-sm text-cream outline-none focus:border-purple-400/50"
                                                                    >
                                                                        <option value="">Not mapped</option>
                                                                        {providerVariants.map((provider) => {
                                                                            const usedElsewhere = variants.some((item) => item.id !== variant.id && item.cjVariantId === provider.vid);
                                                                            return (
                                                                                <option key={provider.vid} value={provider.vid} disabled={usedElsewhere}>
                                                                                    {provider.name} · {provider.sku}{usedElsewhere ? ' · already mapped' : ''}
                                                                                </option>
                                                                            );
                                                                        })}
                                                                    </select>
                                                                </label>
                                                                <div className="min-w-[180px] rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                                                                    {mappedProvider ? (
                                                                        <>
                                                                            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-green-300"><Check className="h-3.5 w-3.5" /> Mapped</div>
                                                                            <p className="mt-1 truncate font-mono text-[10px] text-cream/45">{mappedProvider.vid}</p>
                                                                            {inventory?.totalInventoryNum !== undefined && <p className="mt-1 text-[10px] text-cream/45">{inventory.totalInventoryNum} currently at CJ</p>}
                                                                        </>
                                                                    ) : (
                                                                        <div className="flex items-center gap-1.5 py-2 text-[10px] uppercase tracking-widest text-amber-300"><Unlink className="h-3.5 w-3.5" /> Needs mapping</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {unmatchedProviderVariants.length > 0 && (
                                                <div className="mt-5 rounded-2xl border border-purple-400/15 bg-purple-500/5 p-4">
                                                    <div className="mb-3">
                                                        <h5 className="text-sm font-medium text-purple-100">Unmatched CJ variants</h5>
                                                        <p className="mt-1 text-xs text-cream/45">Create a customer option from CJ, then adjust its label before saving.</p>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                                        {unmatchedProviderVariants.map((provider) => (
                                                            <button
                                                                key={provider.vid}
                                                                type="button"
                                                                aria-label={'Create customer variant from ' + provider.name}
                                                                onClick={() => addCustomerVariant(product, provider)}
                                                                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:border-purple-400/30 hover:bg-purple-500/10"
                                                            >
                                                                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/30">
                                                                    {provider.image ? <SafeImage src={provider.image} alt="" className="h-full w-full object-cover" /> : <Plus className="h-4 w-4 text-purple-300" />}
                                                                </span>
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block truncate text-sm text-cream">{provider.name}</span>
                                                                    <span className="block truncate font-mono text-[10px] text-cream/35">{provider.sku}</span>
                                                                </span>
                                                                <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-purple-200">
                                                                    Create <ArrowRight className="h-3 w-3" />
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                                                <p className="text-xs text-cream/40">
                                                    Changes remain a draft until saved. Saving validates every mapping together.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => saveProduct(product)}
                                                    disabled={!isDirty || savingProduct === product._id}
                                                    className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-white shadow-lg transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    {savingProduct === product._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                                    Save variants & mappings
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </div>
            </section>
        </FadeIn>
    );
};

export default CJVariantManager;
