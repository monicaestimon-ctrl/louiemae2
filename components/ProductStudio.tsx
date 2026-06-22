import React, { useState, useEffect, useRef } from 'react';
import { X, Wand2, Send, ChevronRight, Type, Image as ImageIcon, CheckCircle, ArrowLeft, Eye, Loader2, Upload, Trash2, Box, DollarSign, Download, ExternalLink } from 'lucide-react';
import { Product, SiteContent } from '../types';
import { generateProductNameV2, extractKeywords, ProductContext, suggestProductCategory, isLikelyFallback } from '../services/geminiService';
import { FadeIn } from './FadeIn';
import { useAction } from 'convex/react';
import { api } from '../convex/_generated/api';
import { toast } from 'sonner';
import { extractOtapiFields } from '../lib/otapiHelpers';
import { buildSourceProductSnapshot } from '../lib/smartDescription';
import { getUserFacingErrorMessage } from '../lib/errorMessages';

interface ProductStudioProps {
    isOpen: boolean;
    onClose: () => void;
    initialProduct?: Partial<Product> | null;
    onSave: (product: Partial<Product>) => Promise<void> | void;
    siteContent: SiteContent;
}

type StudioStep = 'essence' | 'visuals' | 'story' | 'review';

export const ProductStudio: React.FC<ProductStudioProps> = ({ isOpen, onClose, initialProduct, onSave, siteContent }) => {
    const [step, setStep] = useState<StudioStep>('essence');
    const [isSaving, setIsSaving] = useState(false);
    const saveSessionRef = useRef(0);
    const [priceDraft, setPriceDraft] = useState('');
    const [product, setProduct] = useState<Partial<Product>>({
        name: '',
        price: 0,
        description: '',
        images: [],
        collection: siteContent.collections[0]?.id || 'furniture',
        category: '',
        isNew: true,
        inStock: true,
        ...initialProduct
    });

    // Reset when opening with new product
    const wasOpenRef = useRef(false);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            setProduct({
                name: '',
                price: 0,
                description: '',
                images: [],
                collection: siteContent.collections[0]?.id || 'furniture',
                category: '',
                isNew: true,
                inStock: true,
                ...initialProduct
            });
            setStep('essence');
            // Reset save state and bump session so any in-flight save is ignored
            setIsSaving(false);
            saveSessionRef.current += 1;
            setPriceDraft(String(initialProduct?.price ?? '0'));
            previousFocusRef.current = document.activeElement as HTMLElement;
        }
        if (!isOpen && wasOpenRef.current && previousFocusRef.current) {
            previousFocusRef.current.focus();
            previousFocusRef.current = null;
        }
        wasOpenRef.current = isOpen;
    }, [isOpen, initialProduct]);

    // Focus trap + Escape handler
    const dialogRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!isOpen) return;
        // Focus the dialog on open
        const timer = setTimeout(() => dialogRef.current?.focus(), 50);

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }
            if (e.key === 'Tab' && dialogRef.current) {
                const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                );
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    // Sync priceDraft when product.price changes programmatically (e.g. scraper import)
    useEffect(() => {
        setPriceDraft(String(product.price ?? 0));
    }, [product.price]);

    // Shared save handler — prevents duplicate concurrent saves
    const handleSave = async () => {
        if (isSaving) return;
        const session = saveSessionRef.current;
        setIsSaving(true);
        try {
            // Normalize price draft before save
            const normalizedPrice = priceDraft === '' ? 0 : Number(priceDraft);
            const normalizedProductPrice = Number.isFinite(normalizedPrice) ? normalizedPrice : 0;
            const suggestedRetailPrice = product.suggestedRetailPrice;
            const adminPriceLocked = Boolean(initialProduct?.id) && Number.isFinite(suggestedRetailPrice)
                ? Math.abs(normalizedProductPrice - Number(suggestedRetailPrice)) >= 0.01
                : product.adminPriceLocked;
            const unlockedPricingSource: Product['pricingSource'] = product.confirmedCjShippingCost !== undefined
                ? 'cj_freight_confirmed'
                : product.confirmedCjProductCost !== undefined || product.confirmedCjCost !== undefined
                    ? 'cj_catalog_confirmed'
                    : 'source_estimate';
            const productToSave = {
                ...product,
                price: normalizedProductPrice,
                adminPriceLocked,
                pricingSource: adminPriceLocked ? 'manual_locked' as const : unlockedPricingSource,
            };
            if (productToSave.smartDescription) {
                const adminEdited = productToSave.description !== productToSave.smartDescription.description;
                productToSave.smartDescription = {
                    ...productToSave.smartDescription,
                    adminEdited,
                    status: adminEdited ? 'edited' : 'approved',
                };
                productToSave.descriptionSource = adminEdited ? 'ai_generated_admin_edited' : 'ai_generated';
            } else if (productToSave.description) {
                productToSave.descriptionSource = productToSave.sourceUrl ? 'source_original' : 'admin_written';
            }
            await Promise.resolve(onSave(productToSave));
        } catch (err) {
            console.error('Product save failed:', err);
            toast.error('Failed to save product');
        } finally {
            // Only clear if this is still the active session
            if (saveSessionRef.current === session) {
                setIsSaving(false);
            }
        }
    };

    // URL Scraper Action
    const scrapeProduct = useAction(api.scraper.scrapeProduct);
    const generateSmartDescription = useAction(api.smartDescriptions.generateSmartDescription);

    if (!isOpen) return null;

    return (
        <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-md flex items-center justify-center p-0 md:p-6 animate-fade-in outline-none" role="dialog" aria-modal="true" aria-labelledby="product-studio-title">
            {/* Centered Modal Container */}
            <div className="w-full h-full md:h-auto md:max-w-6xl md:max-h-[90vh] bg-gradient-to-br from-[#120D09] to-[#0A0705] md:rounded-[2rem] shadow-[0_30px_60px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden relative border border-white/10 animate-fade-in-up">
                
                {/* Inner Glow Border */}
                <div className="absolute inset-0 border border-white/5 pointer-events-none md:rounded-[2rem] rounded-none mix-blend-overlay z-50 pointer-events-none" />

                {/* Header Section - Two Floors */}
                <div className="shrink-0 flex flex-col bg-white/5 backdrop-blur-2xl z-20 shadow-sm border-b border-white/10">

                    {/* Floor 1: Identity (Clean Header) */}
                    <div className="h-auto py-4 md:h-28 flex items-end justify-between px-4 md:px-10 pb-4 md:pb-6 border-b border-white/5 bg-transparent">
                        <div className="flex flex-col gap-1 md:gap-2 min-w-0">
                            <span className="text-[10px] uppercase tracking-[0.3em] text-bronze font-medium flex items-center gap-2 glow-text">
                                <span className="w-6 h-px bg-bronze/50 shadow-[#C19A6B]"></span>
                                The Atelier
                            </span>
                            <h1 id="product-studio-title" className="font-serif text-2xl md:text-4xl text-cream tracking-tight max-w-2xl truncate leading-tight drop-shadow-md">
                                {product.name || <span className="text-cream/20 italic">Untitled Creation</span>}
                            </h1>
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-cream/40 mb-1 hidden md:block">
                            {step === 'review' ? 'Final Polish' : 'Drafting Mode'}
                        </div>
                    </div>

                    {/* Floor 2: Control Deck */}
                    <div className="h-auto py-3 md:h-20 px-4 md:px-8 flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-8 bg-black/20">

                        {/* Left: Exit */}
                        <div className="flex justify-between md:justify-start items-center md:flex-1">
                            <button
                                onClick={onClose}
                                className="group flex items-center gap-2 md:gap-3 text-cream/40 hover:text-red-400 transition-colors px-3 md:px-4 py-2 hover:bg-white/5 rounded-full"
                            >
                                <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
                                <span className="text-[10px] uppercase tracking-widest font-medium group-hover:opacity-100 opacity-60">Close</span>
                            </button>
                            {/* Save on mobile - inline with close */}
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="md:hidden group relative overflow-hidden bg-white/10 text-cream px-5 py-2 rounded-full text-[10px] uppercase tracking-[0.15em] font-medium border border-white/20 disabled:opacity-50"
                            >
                                <span className="flex items-center gap-1.5 drop-shadow-sm">
                                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} {isSaving ? 'Saving...' : 'Save'}
                                </span>
                            </button>
                        </div>

                        {/* Center: Steps */}
                        <div className="flex justify-center">
                            <StudioStepIndicator currentStep={step} />
                        </div>

                        {/* Right: Save (desktop) */}
                        <div className="hidden md:flex justify-end flex-1">
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="group relative overflow-hidden bg-white/10 backdrop-blur-md text-cream px-8 py-3 rounded-full text-xs uppercase tracking-[0.2em] font-medium border border-white/20 hover:bg-white/20 hover:-translate-y-1 shadow-[0_4px_15px_rgba(0,0,0,0.3)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                            >
                                <span className="relative z-10 flex items-center gap-2 drop-shadow-sm">
                                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} {isSaving ? 'Saving...' : 'Save Product'}
                                </span>
                                <div className="absolute inset-0 bg-gradient-to-r from-bronze/0 via-bronze/10 to-bronze/0 transform translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto relative bg-transparent custom-scrollbar">

                    {step === 'essence' && (
                        <EssenceStep
                            product={product}
                            onChange={setProduct}
                            priceDraft={priceDraft}
                            onPriceDraftChange={setPriceDraft}
                            onNext={() => setStep('visuals')}
                            collections={siteContent.collections}
                            scrapeProduct={scrapeProduct}
                            generateSmartDescription={generateSmartDescription}
                        />
                    )}

                    {step === 'visuals' && (
                        <VisualsStep
                            product={product}
                            onChange={setProduct}
                            onBack={() => setStep('essence')}
                            onNext={() => setStep('story')}
                        />
                    )}

                    {step === 'story' && (
                        <StoryStep
                            product={product}
                            onChange={setProduct}
                            onBack={() => setStep('visuals')}
                            onNext={() => setStep('review')}
                            siteContent={siteContent}
                            generateSmartDescription={generateSmartDescription}
                        />
                    )}

                    {step === 'review' && (
                        <ReviewStep
                            product={product}
                            onChange={setProduct}
                            onBack={() => setStep('story')}
                            onSave={handleSave}
                            isSaving={isSaving}
                            priceDraft={priceDraft}
                            siteContent={siteContent}
                        />
                    )}

                </div>
            </div>
        </div>
    );
};

// --- Sub-Components ---

const StudioStepIndicator: React.FC<{ currentStep: StudioStep }> = ({ currentStep }) => {
    const steps: { id: StudioStep; label: string; icon: React.ComponentType<any> }[] = [
        { id: 'essence', label: 'Essence', icon: Box },
        { id: 'visuals', label: 'Visuals', icon: ImageIcon },
        { id: 'story', label: 'Story', icon: Type },
        { id: 'review', label: 'Review', icon: Eye },
    ];

    return (
        <div className="flex items-center bg-black/40 backdrop-blur-3xl rounded-full p-1.5 border border-white/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
            {steps.map((s) => {
                const isActive = s.id === currentStep;
                const isPast = steps.findIndex(step => step.id === s.id) < steps.findIndex(step => step.id === currentStep);

                return (
                    <div
                        key={s.id}
                        className={`flex items-center gap-2 px-5 py-2 rounded-full text-[10px] uppercase tracking-widest font-medium transition-all duration-500 ${isActive
                            ? 'bg-white/10 shadow-[0_4px_15px_rgba(0,0,0,0.3)] text-bronze border border-white/20'
                            : isPast
                                ? 'text-cream/80 hover:bg-white/5'
                                : 'text-cream/30 hover:text-cream/50'
                            }`}
                    >
                        <s.icon className={`w-3.5 h-3.5 ${isActive ? 'text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]' : 'opacity-70'}`} />
                        <span className={isActive ? 'opacity-100 drop-shadow-sm' : 'hidden md:block'}>{s.label}</span>
                    </div>
                );
            })}
        </div>
    );
};

// --- Step 1: Essence ---
const EssenceStep: React.FC<{
    product: Partial<Product>;
    onChange: (p: any) => void;
    priceDraft: string;
    onPriceDraftChange: (value: string) => void;
    onNext: () => void;
    collections: any[];
    scrapeProduct: any;
    generateSmartDescription: any;
}> = ({ product, onChange, priceDraft, onPriceDraftChange, onNext, collections, scrapeProduct, generateSmartDescription }) => {
    const [isGeneratingName, setIsGeneratingName] = useState(false);
    const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
    const [isCategorizing, setIsCategorizing] = useState(false);

    // Import Logic
    const [importUrl, setImportUrl] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [autoEnhance, setAutoEnhance] = useState(false); // Default off to avoid quota issues

    const handleImport = async () => {
        const normalizedUrl = importUrl.trim();
        if (!normalizedUrl) return;
        setIsImporting(true);
        try {
            const result = await scrapeProduct({ url: normalizedUrl });
            if (!result) throw new Error("Failed to fetch");

            let scrapedData: any = {};

            if (result.source === '1688') {
                // OTAPI 1688 product — use shared extraction helper
                const item = result.data;
                if (item) {
                    const fields = extractOtapiFields(item, normalizedUrl);
                    scrapedData = {
                        name: fields.name,
                        price: fields.price,
                        description: fields.description,
                        images: fields.images,
                        sourceUrl: normalizedUrl,
                        variants: (fields as any).variants || [],
                        sourceMetadata: { source: '1688' },
                    };
                }
            } else {
                // Generic source (handles AliExpress, Amazon, and any other URLs)
                const data = result.data;
                scrapedData = {
                    name: data.title,
                    price: data.price,
                    description: data.description,
                    images: Array.isArray(data.images) && data.images.length > 0
                        ? data.images
                        : (data.image ? [data.image] : []),
                    sourceUrl: normalizedUrl,
                    sourceMetadata: data,
                };
            }

            // Merge data
            const scrapedImages = Array.isArray(scrapedData.images) ? scrapedData.images : [];
            const parsedPrice = Number(scrapedData.price);
            const updatedProduct = {
                ...product,
                ...scrapedData,
                // Only overwrite if scraped data exists
                name: scrapedData.name ?? product.name,
                price: Number.isFinite(parsedPrice) ? parsedPrice : product.price,
                description: scrapedData.description ?? product.description,
                images: scrapedImages.length > 0 ? scrapedImages : product.images
            };

            // AI Enhance if enabled
            if (autoEnhance) {
                const context: ProductContext = {
                    originalName: updatedProduct.name,
                    originalDescription: updatedProduct.description || '',
                    category: '',
                    collection: updatedProduct.collection,
                    keywords: extractKeywords(updatedProduct.name + ' ' + (updatedProduct.description || '')),
                };

                // Try AI enhancement
                try {
                    const sourceSnapshot = buildSourceProductSnapshot({
                        sourceUrl: normalizedUrl,
                        name: updatedProduct.name,
                        description: updatedProduct.description,
                        price: Number(updatedProduct.price),
                        currency: 'USD',
                        images: updatedProduct.images || [],
                        variants: updatedProduct.variants || [],
                        category: updatedProduct.category,
                        collection: updatedProduct.collection,
                        sourceMetadata: scrapedData.sourceMetadata || {},
                    });

                    const [name, smartDescription] = await Promise.all([
                        generateProductNameV2(context).catch(() => updatedProduct.name),
                        generateSmartDescription({
                            request: {
                                sourceSnapshot,
                                adminContext: {
                                    selectedCategory: updatedProduct.category,
                                    selectedCollection: updatedProduct.collection,
                                },
                                generationMode: 'manual_generate',
                                options: {
                                    allowImageAnalysis: true,
                                    allowSeoKeywords: true,
                                    forceFreshVariation: true,
                                },
                            },
                        } as any).catch(() => null)
                    ]);

                    if (name && !isLikelyFallback(name)) updatedProduct.name = name;
                    const smartDescriptionResult = smartDescription as any;
                    if (smartDescriptionResult?.ok && smartDescriptionResult.description) {
                        updatedProduct.description = smartDescriptionResult.description;
                        updatedProduct.smartDescription = {
                            description: smartDescriptionResult.description,
                            auditId: smartDescriptionResult.auditId,
                            generatedAt: Date.now(),
                            model: 'server-configured',
                            promptVersion: 'smart-description-v2.0.0',
                            sourceSnapshotHash: 'pending-link',
                            adminEdited: false,
                            status: smartDescriptionResult.fallbackUsed ? 'fallback' : 'generated',
                        };
                        updatedProduct.descriptionSource = 'ai_generated';
                    }

                    toast.success("Imported & Enhanced!");
                } catch (e) {
                    console.warn("AI Enhance failed", e);
                    toast.success("Imported (AI skipped)");
                }
            } else {
                toast.success("Data Imported");
            }

            onChange(updatedProduct);

        } catch (err) {
            console.error(err);
            toast.error(getUserFacingErrorMessage(err, 'Failed to import URL. Please try a different link.'));
        } finally {
            setIsImporting(false);
        }
    };

    const handleGenerateName = async () => {
        setIsGeneratingName(true);
        setNameSuggestions([]);
        try {
            const collectionName = collections.find(c => c.id === product.collection)?.title || product.collection || 'Furniture';

            const context: ProductContext = {
                originalName: product.name || '',
                originalDescription: product.description || '',
                category: product.category || '',
                collection: collectionName,
            };
            const name = await generateProductNameV2(context);
            setNameSuggestions([name]);
        } catch (err) {
            console.error('Name generation failed:', err);
            toast.error('Failed to generate name suggestions');
        } finally {
            setIsGeneratingName(false);
        }
    };

    const handleAutoCategorize = async () => {
        if (!product.name) return;
        setIsCategorizing(true);
        try {
            const category = await suggestProductCategory(product.name, product.description || '');
            if (category) {
                onChange({ ...product, category });
            }
        } catch (err) {
            console.error('Auto-categorize failed:', err);
            toast.error('Failed to detect category');
        } finally {
            setIsCategorizing(false);
        }
    };

    return (
        <div className="h-full flex flex-col items-center justify-start animate-fade-in-up p-8 overflow-y-auto">
            <div className="w-full max-w-5xl space-y-12 pb-24">

                {/* 1. Quick Import Section - Refined Design */}
                <div className="bg-white/5 backdrop-blur-3xl p-8 rounded-[2rem] shadow-[0_15px_30px_rgba(0,0,0,0.3)] border border-white/10 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-bronze/10 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110 blur-xl"></div>
                    <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-[2rem] group-hover:border-white/10 mix-blend-overlay" />

                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-gradient-to-br from-bronze/20 to-bronze/5 border border-bronze/30 rounded-xl text-amber-400 shadow-[0_0_15px_rgba(193,154,107,0.3)]">
                                <Wand2 className="w-5 h-5 drop-shadow-[0_0_3px_currentColor]" />
                            </div>
                            <div>
                                <h3 className="font-serif text-2xl text-cream drop-shadow-sm">Quick Start</h3>
                                <p className="text-cream/60 font-light text-sm">Paste a URL to auto-fill details from supported storefronts.</p>
                            </div>
                        </div>

                        <div className="flex gap-4 items-start">
                            <div className="flex-1 relative">
                                <label htmlFor="product-import-url" className="sr-only">Product URL</label>
                                <input
                                    id="product-import-url"
                                    type="text"
                                    value={importUrl}
                                    onChange={(e) => setImportUrl(e.target.value)}
                                    placeholder="https://..."
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-cream text-sm focus:outline-none focus:bg-black/60 focus:border-bronze/50 transition-all placeholder:text-cream/20 shadow-inner"
                                />
                            </div>
                            <button
                                onClick={handleImport}
                                disabled={isImporting || !importUrl.trim()}
                                className="px-6 py-3 bg-white/10 text-cream border border-white/20 rounded-xl text-sm font-medium hover:bg-white/20 transition-all flex items-center gap-2 disabled:opacity-50 shadow-[0_4px_15px_rgba(0,0,0,0.3)] backdrop-blur-md"
                            >
                                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4 text-bronze" />}
                                {isImporting ? 'Fetching...' : 'Auto-Fill'}
                            </button>
                        </div>

                        {/* AI Toggle */}
                        <div className="mt-4 flex items-center gap-2">
                            <label className="flex items-center gap-2 cursor-pointer group select-none">
                                <input type="checkbox" checked={autoEnhance} onChange={(e) => setAutoEnhance(e.target.checked)} className="sr-only peer" />
                                <div className={`w-9 h-5 rounded-full p-1 transition-colors border peer-focus:ring-2 peer-focus:ring-bronze/50 ${autoEnhance ? 'bg-bronze/40 border-bronze/50' : 'bg-black/40 border-white/10'}`}>
                                    <div className={`w-3 h-3 rounded-full shadow-sm transition-transform ${autoEnhance ? 'bg-amber-400 translate-x-4 shadow-[0_0_5px_currentColor]' : 'bg-cream/50 translate-x-0'}`} />
                                </div>
                                <span className={`text-xs font-medium tracking-wide transition-colors ${autoEnhance ? 'text-amber-400 drop-shadow-sm' : 'text-cream/40'}`}>
                                    Auto-Enhance
                                </span>
                            </label>
                            <span className="text-[10px] text-cream/30">(Writes descriptions for you)</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="h-px bg-white/10 flex-1"></div>
                    <span className="text-xs uppercase tracking-widest text-cream/30">Or Create Manually</span>
                    <div className="h-px bg-white/10 flex-1"></div>
                </div>

                {/* 2. Manual Details Form - 2 Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

                    {/* Left: Core Identity */}
                    <div className="space-y-8 bg-white/5 backdrop-blur-2xl p-8 rounded-[2rem] border border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.2)]">
                        <div className="space-y-4">
                            <label className="text-xs uppercase tracking-widest text-cream/40 glow-text">Collection</label>
                            <div className="flex flex-wrap gap-3">
                                {collections.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => onChange({ ...product, collection: c.id })}
                                        aria-pressed={product.collection === c.id}
                                        className={`px-4 py-2 text-sm rounded-full border transition-all ${product.collection === c.id
                                            ? 'border-bronze/50 bg-gradient-to-r from-bronze/20 to-bronze/5 text-amber-400 shadow-[0_0_15px_rgba(193,154,107,0.3)]'
                                            : 'border-white/10 text-cream/60 hover:border-white/30 hover:bg-white/5 hover:text-cream'}`}
                                    >
                                        {c.title}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <label htmlFor="product-name" className="text-xs uppercase tracking-widest text-cream/40 glow-text">Product Name</label>
                                <button
                                    onClick={handleGenerateName}
                                    disabled={isGeneratingName}
                                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-bronze hover:text-amber-400 transition-colors disabled:opacity-50"
                                >
                                    {isGeneratingName ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                                    Suggest Names
                                </button>
                            </div>
                            <input
                                id="product-name"
                                type="text"
                                value={product.name}
                                onChange={(e) => onChange({ ...product, name: e.target.value })}
                                placeholder="e.g. The Velocity Chair"
                                className="w-full text-3xl font-serif text-cream border-b border-white/10 py-2 focus:outline-none focus:border-bronze bg-transparent placeholder:text-cream/10 transition-colors drop-shadow-sm"
                            />
                            {/* Suggestions */}
                            {nameSuggestions.length > 0 && (
                                <div className="flex flex-wrap gap-2 animate-fade-in">
                                    {nameSuggestions.map((name, i) => (
                                        <button
                                            key={i}
                                            onClick={() => { onChange({ ...product, name }); setNameSuggestions([]); }}
                                            className="px-3 py-1.5 bg-black/40 text-cream/80 text-xs rounded-full hover:bg-bronze/20 hover:text-amber-400 border border-white/5 transition-colors"
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Market Details */}
                    <div className="space-y-8 bg-white/5 backdrop-blur-2xl p-8 rounded-[2rem] border border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.2)]">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <label htmlFor="product-category" className="text-xs uppercase tracking-widest text-cream/40 glow-text">Category</label>
                                <button
                                    onClick={handleAutoCategorize}
                                    disabled={isCategorizing || !product.name}
                                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-bronze hover:text-amber-400 transition-colors disabled:opacity-50"
                                >
                                    {isCategorizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                                    Auto-Detect
                                </button>
                            </div>
                            <select
                                id="product-category"
                                value={product.category || ''}
                                onChange={(e) => onChange({ ...product, category: e.target.value })}
                                className="w-full text-lg text-cream/80 border-b border-white/10 py-3 focus:outline-none focus:border-bronze bg-transparent transition-colors cursor-pointer appearance-none"
                                style={{ WebkitAppearance: 'none' }}
                            >
                                <option value="" className="bg-[#120D09]">Select a category...</option>
                                {collections.find(c => c.id === product.collection)?.subcategories?.map((cat: any) => (
                                    <option key={cat.id} value={cat.title} className="bg-[#120D09]">
                                        {cat.title.replace(collections.find(c => c.id === product.collection)?.title + ' ', '')}
                                    </option>
                                ))}
                                <option value="Other" className="bg-[#120D09]">Other / Custom</option>
                            </select>
                        </div>

                        <div className="space-y-4">
                            <label htmlFor="product-price" className="text-xs uppercase tracking-widest text-cream/40 glow-text">Price</label>
                            <div className="relative">
                                <DollarSign className="absolute left-0 top-1/2 -translate-y-1/2 w-6 h-6 text-cream/20" />
                                <input
                                    id="product-price"
                                    type="text"
                                    inputMode="decimal"
                                    value={priceDraft}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        // Allow digits, one decimal point, and empty
                                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                            onPriceDraftChange(val);
                                        }
                                    }}
                                    onBlur={() => {
                                        // Normalize on blur: commit number back to product
                                        const num = Number(priceDraft);
                                        onChange({ ...product, price: Number.isFinite(num) ? num : 0 });
                                    }}
                                    placeholder="0"
                                    className="w-full text-3xl font-serif text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)] border-b border-white/10 py-2 pl-8 focus:outline-none focus:border-bronze bg-transparent placeholder:text-cream/10 transition-colors"
                                />
                            </div>
                            {(product.estimatedLandedCost || product.confirmedLandedCost || product.suggestedRetailPrice || product.pricingWarnings?.length) && (
                                <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-2">
                                    <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-cream/40">
                                        <span>Pricing Stack</span>
                                        <span>{product.pricingSource || product.pricingStage || 'estimate'}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs text-cream/70">
                                        <div className="flex justify-between gap-2">
                                            <span>CJ Product</span>
                                            <span className="font-mono text-cream">${(product.confirmedCjProductCost ?? product.confirmedCjCost ?? product.estimatedCjProductCost ?? product.estimatedCjCost ?? 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>CJ Shipping</span>
                                            <span className="font-mono text-cream">${(product.confirmedCjShippingCost ?? product.estimatedCjShippingCost ?? product.estimatedShipping ?? 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>Fees/Tax</span>
                                            <span className="font-mono text-cream">${((product.confirmedCjServiceFee ?? 0) + (product.confirmedCjTaxesFee ?? 0) + (product.confirmedCjClearanceFee ?? 0) + (product.confirmedCjRemoteFee ?? 0)).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>Landed</span>
                                            <span className="font-mono text-cream">${(product.confirmedLandedCost ?? product.estimatedLandedCost ?? 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>Suggested</span>
                                            <span className="font-mono text-amber-300">${(product.suggestedRetailPrice ?? 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>{product.adminPriceLocked ? 'Locked Price' : 'Current Price'}</span>
                                            <span className="font-mono text-amber-300">${(Number(priceDraft) || product.price || 0).toFixed(2)}</span>
                                        </div>
                                    </div>
                                    {product.confirmedCjLogisticsName && (
                                        <p className="text-[11px] text-cream/50">Logistics: {product.confirmedCjLogisticsName}</p>
                                    )}
                                    {product.pricingWarnings?.map((warning, index) => (
                                        <p key={`${warning}-${index}`} className="text-[11px] text-amber-200/80">{warning}</p>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <label htmlFor="product-source-url" className="text-xs uppercase tracking-widest text-cream/40 glow-text">Sourcing URL</label>
                                {product.sourceUrl && (
                                    <a
                                        href={product.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-bronze hover:text-amber-400 transition-colors"
                                    >
                                        <ExternalLink className="w-3 h-3" />
                                        Open
                                    </a>
                                )}
                            </div>
                            <input
                                id="product-source-url"
                                type="url"
                                value={product.sourceUrl || ''}
                                onChange={(e) => onChange({ ...product, sourceUrl: e.target.value })}
                                placeholder="https://supplier-product-url..."
                                className="w-full text-sm font-mono text-cream/80 border-b border-white/10 py-3 focus:outline-none focus:border-bronze bg-transparent placeholder:text-cream/20 transition-colors"
                            />
                        </div>

                        <div className="flex gap-6 pt-2">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <input type="checkbox" checked={product.isNew || false} onChange={(e) => onChange({ ...product, isNew: e.target.checked })} className="sr-only peer" />
                                <div className={`w-5 h-5 border rounded flex items-center justify-center transition-colors peer-focus:ring-2 peer-focus:ring-bronze/50 ${product.isNew ? 'bg-bronze/40 border-bronze/50' : 'bg-black/40 border-white/10 group-hover:border-white/30'}`}>
                                    {product.isNew && <CheckCircle className="w-3.5 h-3.5 text-amber-400 shadow-[0_0_5px_currentColor]" />}
                                </div>
                                <span className="text-xs uppercase tracking-widest text-cream/70 group-hover:text-cream">New Arrival</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer group">
                                <input type="checkbox" checked={product.inStock || false} onChange={(e) => onChange({ ...product, inStock: e.target.checked })} className="sr-only peer" />
                                <div className={`w-5 h-5 border rounded flex items-center justify-center transition-colors peer-focus:ring-2 peer-focus:ring-green-500/50 ${product.inStock ? 'bg-green-500/20 border-green-500/30' : 'bg-black/40 border-white/10 group-hover:border-white/30'}`}>
                                    {product.inStock && <CheckCircle className="w-3.5 h-3.5 text-green-400 shadow-[0_0_5px_currentColor]" />}
                                </div>
                                <span className="text-xs uppercase tracking-widest text-cream/70 group-hover:text-cream">In Stock</span>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-8">
                    <button onClick={onNext} disabled={!product.name} className="py-4 px-12 bg-white/10 text-cream border border-white/20 rounded-xl hover:bg-white/20 hover:-translate-y-1 transition-all flex items-center gap-2 text-lg font-light tracking-wide shadow-[0_4px_20px_rgba(0,0,0,0.4)] backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none">
                        Next: Imagery <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Step 2: Visuals ---
const VisualsStep: React.FC<{ product: Partial<Product>; onChange: (p: any) => void; onBack: () => void; onNext: () => void; }> = ({ product, onChange, onBack, onNext }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewImage, setPreviewImage] = useState<{ src: string; index: number } | null>(null);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                onChange({ ...product, images: [...(product.images || []), reader.result as string] });
            };
            reader.readAsDataURL(file);
        }
    };

    const removeImage = (index: number) => {
        const newImages = [...(product.images || [])];
        newImages.splice(index, 1);
        onChange({ ...product, images: newImages });
        setPreviewImage((current) => current?.index === index ? null : current);
    };

    const getImageDownloadHref = (src: string, index: number) => {
        const filename = `${(product.name || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product'}-${index + 1}`;

        if (src.startsWith('data:')) {
            return src;
        }

        const absoluteUrl = src.startsWith('/')
            ? `${window.location.origin}${src}`
            : src;

        return `/api/download-image?url=${encodeURIComponent(absoluteUrl)}&filename=${encodeURIComponent(filename)}`;
    };

    const handleDownload = (src: string, index: number) => {
        const link = document.createElement('a');
        link.href = getImageDownloadHref(src, index);
        link.download = `${(product.name || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product'}-${index + 1}`;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    return (
        <div className="h-full flex flex-col items-center p-8 animate-fade-in-up">
            <div className="w-full max-w-6xl space-y-8">
                <div className="flex items-center gap-4 mb-4">
                    <button onClick={onBack} aria-label="Go back" className="text-cream/40 hover:text-cream p-2 rounded-full hover:bg-white/10 transition-colors"><ArrowLeft className="w-6 h-6" /></button>
                    <div>
                        <h2 className="font-serif text-3xl text-cream drop-shadow-md">Curate Visuals</h2>
                        <p className="text-cream/60 font-light">Upload high-quality imagery to showcase this piece.</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {/* Upload Tile */}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="aspect-[3/4] bg-white/5 backdrop-blur-3xl border border-white/10 border-dashed rounded-[2rem] flex flex-col items-center justify-center gap-4 text-cream/40 hover:text-cream hover:border-bronze/50 hover:bg-white/10 hover:shadow-[0_15px_30px_rgba(0,0,0,0.3)] hover:-translate-y-1 transition-all duration-300 group shadow-inner"
                    >
                        <div className="p-4 bg-black/40 border border-white/10 rounded-full shadow-inner group-hover:scale-110 group-hover:bg-black/60 transition-transform">
                            <Upload className="w-6 h-6 text-bronze group-hover:text-amber-400 drop-shadow-[0_0_5px_currentColor]" />
                        </div>
                        <span className="text-[10px] uppercase tracking-widest font-medium">Add Image</span>
                        <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                    </button>

                    {/* Image Tiles */}
                    {product.images?.map((img, idx) => (
                        <div key={idx} className="relative aspect-[3/4] bg-black/20 group rounded-[2rem] overflow-hidden shadow-[0_10px_20px_rgba(0,0,0,0.2)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.5)] border border-white/10 hover:border-white/20 hover:-translate-y-2 transition-all duration-300">
                            <div className="absolute inset-0 border border-white/5 mix-blend-overlay pointer-events-none rounded-[2rem] z-20"></div>
                            <button
                                type="button"
                                onClick={() => setPreviewImage({ src: img, index: idx })}
                                className="absolute inset-0 z-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/60"
                                aria-label={`Open image ${idx + 1} full screen`}
                            >
                                <img src={img} alt={`Product ${idx + 1}`} referrerPolicy="no-referrer" crossOrigin="anonymous" className="w-full h-full object-cover opacity-90 group-hover:scale-110 group-hover:opacity-100 transition-all duration-700" />
                            </button>
                            <div className="absolute inset-0 bg-gradient-to-b from-black/0 to-black/70 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2 z-10 pointer-events-none">
                                <button
                                    type="button"
                                    onClick={() => setPreviewImage({ src: img, index: idx })}
                                    aria-label={`View image ${idx + 1} full screen`}
                                    className="pointer-events-auto p-3 bg-white/10 text-cream border border-white/20 rounded-full hover:bg-white/20 transition-colors shadow-lg backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/60"
                                >
                                    <Eye className="w-5 h-5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDownload(img, idx)}
                                    aria-label={`Download image ${idx + 1}`}
                                    className="pointer-events-auto p-3 bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 rounded-full hover:bg-emerald-500/25 transition-colors shadow-lg backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                                >
                                    <Download className="w-5 h-5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => removeImage(idx)}
                                    aria-label={`Delete image ${idx + 1}`}
                                    className="pointer-events-auto p-3 bg-red-500/20 text-red-400 border border-red-500/30 rounded-full hover:bg-red-500/40 hover:text-red-300 transition-colors shadow-lg backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                            {idx === 0 && (
                                <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md px-3 py-1.5 text-[9px] uppercase tracking-widest rounded-full font-medium text-amber-400 border border-white/10 shadow-sm z-30 drop-shadow-[0_0_5px_currentColor]">
                                    Main Image
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {previewImage && (
                    <div
                        className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-xl p-4 md:p-8 flex flex-col"
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Image ${previewImage.index + 1} full screen preview`}
                    >
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <span className="text-cream/60 text-xs uppercase tracking-[0.25em]">
                                Image {previewImage.index + 1} of {product.images?.length || 0}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleDownload(previewImage.src, previewImage.index)}
                                    className="flex items-center gap-2 px-4 py-2 bg-white/10 text-cream border border-white/20 rounded-xl hover:bg-white/20 transition-colors text-xs uppercase tracking-widest"
                                >
                                    <Download className="w-4 h-4" />
                                    Download
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPreviewImage(null)}
                                    aria-label="Close image preview"
                                    className="p-2 bg-white/10 text-cream border border-white/20 rounded-full hover:bg-white/20 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 flex items-center justify-center">
                            <img
                                src={previewImage.src}
                                alt={`Product image ${previewImage.index + 1}`}
                                referrerPolicy="no-referrer"
                                crossOrigin="anonymous"
                                className="max-h-full max-w-full object-contain rounded-xl shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
                            />
                        </div>
                    </div>
                )}

                <div className="flex justify-end pt-8">
                    <button onClick={onNext} className="py-4 px-12 bg-white/10 text-cream border border-white/20 rounded-xl hover:bg-white/20 hover:-translate-y-1 transition-all flex items-center gap-2 text-lg font-light tracking-wide shadow-[0_4px_20px_rgba(0,0,0,0.4)] backdrop-blur-md">
                        Next: Story <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Step 3: Story (Zen Mode) ---
const StoryStep: React.FC<{ product: Partial<Product>; onChange: (p: any) => void; onBack: () => void; onNext: () => void; siteContent: SiteContent; generateSmartDescription: any }> = ({ product, onChange, onBack, onNext, siteContent, generateSmartDescription }) => {
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerateDescription = async () => {
        setIsGenerating(true);
        try {
            const collectionName = siteContent.collections.find(c => c.id === product.collection)?.title || product.collection || 'Furniture';
            const sourceSnapshot = buildSourceProductSnapshot({
                sourceUrl: product.sourceUrl,
                name: product.name || 'this item',
                description: product.description || '',
                price: Number(product.price),
                currency: 'USD',
                images: product.images || [],
                variants: product.variants || [],
                category: product.category || 'home decor',
                collection: product.collection || collectionName,
                sourceMetadata: {
                    existingProductId: product.id,
                    descriptionSource: product.descriptionSource,
                },
            });

            const result = await generateSmartDescription({
                request: {
                    productId: product.id,
                    sourceSnapshot,
                    adminContext: {
                        selectedCategory: product.category || 'home decor',
                        selectedCollection: product.collection || collectionName,
                    },
                    generationMode: product.smartDescription?.auditId ? 'manual_regenerate' : 'manual_generate',
                    options: {
                        allowImageAnalysis: true,
                        allowSeoKeywords: true,
                        forceFreshVariation: true,
                    },
                },
            } as any);

            if (!(result as any)?.ok || !(result as any).description) {
                throw new Error((result as any)?.error || 'Smart description failed');
            }

            onChange({
                ...product,
                description: (result as any).description,
                smartDescription: {
                    description: (result as any).description,
                    auditId: (result as any).auditId,
                    generatedAt: Date.now(),
                    model: 'server-configured',
                    promptVersion: 'smart-description-v2.0.0',
                    sourceSnapshotHash: 'pending-link',
                    adminEdited: false,
                    status: (result as any).fallbackUsed ? 'fallback' : 'generated',
                },
                descriptionSource: 'ai_generated',
            });
        } catch (err) {
            console.error('Smart description generation failed:', err);
            toast.error('Smart description could not be generated');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="h-full flex flex-col md:flex-row animate-fade-in-up">
            {/* Editor Side */}
            <div className="w-full md:w-1/2 p-4 md:p-12 border-b md:border-b-0 md:border-r border-white/10 flex flex-col md:h-full bg-transparent relative">
                <div className="flex items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} aria-label="Go back" className="text-cream/40 hover:text-cream p-2 rounded-full hover:bg-white/10 transition-colors"><ArrowLeft className="w-6 h-6" /></button>
                        <div>
                            <h2 className="font-serif text-3xl text-cream drop-shadow-md">Craft the Story</h2>
                            <p className="text-cream/60 font-light">Describe the details that make this unique.</p>
                        </div>
                    </div>
                    {/* Generate Description button */}
                    <button
                        onClick={handleGenerateDescription}
                        disabled={isGenerating || !product.name}
                        className="flex items-center gap-2 bg-bronze/20 border border-bronze/30 text-amber-400 px-4 py-2 rounded-xl text-xs uppercase tracking-widest hover:bg-bronze hover:text-white transition-all disabled:opacity-50 shadow-[0_0_15px_rgba(193,154,107,0.2)] shrink-0"
                    >
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        Generate
                    </button>
                </div>

                <div className="flex-1 relative bg-black/20 rounded-2xl backdrop-blur-xl border border-white/5 shadow-inner">
                    <label htmlFor="product-description" className="sr-only">Description</label>
                    <textarea
                        id="product-description"
                        value={product.description}
                        onChange={(e) => onChange({ ...product, description: e.target.value })}
                        placeholder="Start writing..."
                        className="w-full h-full resize-none focus:outline-none focus:border-bronze font-serif text-xl leading-relaxed text-cream placeholder:text-cream/20 bg-transparent p-6 rounded-2xl transition-all shadow-inner"
                    />
                    {product.smartDescription && (
                        <div className="absolute left-4 right-4 bottom-4 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-[10px] uppercase tracking-widest text-cream/50 backdrop-blur-md flex flex-wrap gap-3">
                            <span>Status: {product.smartDescription.status}</span>
                            <span>Audit: {String(product.smartDescription.auditId).slice(0, 10)}...</span>
                            <span>{product.description === product.smartDescription.description ? 'Ready to approve' : 'Admin edited'}</span>
                        </div>
                    )}
                </div>

                <div className="pt-8 flex justify-end">
                    <button onClick={onNext} className="py-4 px-12 bg-white/10 text-cream border border-white/20 rounded-xl hover:bg-white/20 hover:-translate-y-1 transition-all flex items-center gap-2 text-lg font-light tracking-wide shadow-[0_4px_20px_rgba(0,0,0,0.4)] backdrop-blur-md">
                        Next: Review <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Preview Side */}
            <div className="w-full md:w-1/2 p-6 md:p-12 flex items-center justify-center relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#1A130A]/50 to-transparent pointer-events-none" />
                <div className="max-w-md w-full bg-white/5 backdrop-blur-3xl p-8 rounded-[3rem] shadow-[0_30px_60px_rgba(0,0,0,0.5)] border border-white/10 text-center space-y-6 relative hover:-translate-y-2 transition-transform duration-700">
                    <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-[3rem] mix-blend-overlay" />
                    
                    <h3 className="text-xs uppercase tracking-widest text-cream/40 glow-text">Live Preview</h3>
                    <div className="text-center space-y-6">
                        <h2 className="font-serif text-3xl text-cream drop-shadow-md">{product.name || 'Untitled Product'}</h2>
                        <div className="w-16 h-px bg-bronze/50 mx-auto shadow-[#C19A6B]"></div>
                        <p className="font-serif text-cream/70 leading-relaxed italic text-lg opacity-80 backdrop-blur-sm">
                            "{product.description || 'Description will appear here...'}"
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Step 4: Review ---
const ReviewStep: React.FC<{ product: Partial<Product>; onChange: (p: any) => void; onBack: () => void; onSave: () => void; isSaving: boolean; priceDraft: string; siteContent: SiteContent }> = ({ product, onChange, onBack, onSave, isSaving, priceDraft, siteContent }) => {
    return (
        <div className="h-full flex flex-col items-center justify-center p-4 md:p-8 animate-fade-in-up">
            <div className="w-full max-w-5xl space-y-10">
                <div className="flex items-center gap-4 mb-4 justify-center relative">
                    <button onClick={onBack} aria-label="Go back" className="text-cream/40 hover:text-cream p-2 rounded-full hover:bg-white/10 transition-colors absolute left-0 md:left-8"><ArrowLeft className="w-6 h-6" /></button>
                    <div className="text-center">
                        <h2 className="font-serif text-3xl text-cream drop-shadow-md">Ready to Launch?</h2>
                        <p className="text-cream/60 font-light">Review the final card as it will appear on the site.</p>
                    </div>
                </div>

                <div className="flex justify-center">
                    {/* Detailed Product Card Preview - Dark Mode Glass */}
                    <div className="group relative w-full max-w-sm overflow-hidden bg-white/5 backdrop-blur-2xl rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.5)] hover:shadow-[0_30px_60px_rgba(0,0,0,0.7)] transition-all duration-500 cursor-pointer border border-white/10 hover:-translate-y-2">
                        <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-2xl mix-blend-overlay z-50"></div>
                        
                        <div className="aspect-[3/4] w-full overflow-hidden bg-black/40 relative">
                            {product.images && product.images.length > 0 ? (
                                <img
                                    src={product.images[0]}
                                    alt={product.name}
                                    referrerPolicy="no-referrer"
                                    crossOrigin="anonymous"
                                    className="h-full w-full object-cover object-center transition-transform duration-1000 group-hover:scale-110 opacity-90 group-hover:opacity-100"
                                />
                            ) : (
                                <div className="h-full w-full flex items-center justify-center text-cream/20">
                                    <ImageIcon className="w-12 h-12" />
                                </div>
                            )}

                            {product.isNew && (
                                <div className="absolute top-4 left-4 z-20">
                                    <span className="bg-black/40 backdrop-blur-md text-amber-400 px-3 py-1 text-[10px] uppercase tracking-widest font-medium border border-white/10 shadow-[0_0_10px_rgba(0,0,0,0.5)] rounded-full drop-shadow-[0_0_3px_currentColor]">New Arrival</span>
                                </div>
                            )}

                            <div className="absolute inset-x-0 bottom-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex justify-center pb-8 bg-gradient-to-t from-black/80 to-transparent z-20 pointer-events-none" aria-hidden="true">
                                <span className="bg-white/10 backdrop-blur-md text-cream px-6 py-3 text-xs uppercase tracking-[0.2em] border border-white/20 rounded-full">
                                    View Details
                                </span>
                            </div>
                        </div>
                        <div className="p-6 text-center space-y-2 relative z-10 bg-gradient-to-t from-black/60 to-transparent">
                            <h3 className="font-serif text-xl tracking-tight text-cream drop-shadow-sm group-hover:text-amber-400 transition-colors">
                                {product.name}
                            </h3>
                            <div className="flex items-center justify-center gap-2 text-sm font-light text-cream/60">
                                <span>{product.category}</span>
                                <span className="w-1 h-1 rounded-full bg-cream/20"></span>
                                <span className="text-bronze font-medium">${priceDraft || '0'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-center pt-8">
                    <button onClick={onSave} disabled={isSaving} className="py-4 px-16 bg-white/10 text-cream backdrop-blur-md border border-white/20 rounded-xl hover:bg-white/20 hover:-translate-y-1 transition-all flex items-center gap-3 text-xl font-light tracking-wide shadow-[0_10px_30px_rgba(0,0,0,0.4)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.6)] duration-300 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none">
                        <span className="absolute inset-0 bg-gradient-to-r from-bronze/0 via-bronze/20 to-bronze/0 transform -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></span>
                        {isSaving ? <Loader2 className="w-6 h-6 animate-spin text-bronze" /> : <Send className="w-6 h-6 text-bronze drop-shadow-[0_0_5px_currentColor]" />} <span className="relative z-10">{isSaving ? 'Publishing...' : 'Publish Product'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
