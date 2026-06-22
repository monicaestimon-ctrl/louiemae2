
import React, { useState, useMemo, useCallback } from 'react';
import { FadeIn } from './FadeIn';
import { useSite } from '../contexts/BlogContext';
import { Product, CollectionType, ProductVariant, Category } from '../types';
import { ArrowLeft, X, ArrowUpRight, ShoppingBag, Check } from 'lucide-react';
import { AddToCartButton } from './cart';
import { CircularGallery, GalleryItem } from './ui/circular-gallery-2';
import { CurvedCategoryCarousel } from './ui/CurvedCategoryCarousel';
import { GlassButton } from './ui/GlassButton';
import { useNewsletter } from '../contexts/NewsletterContext';
import { SafeImage } from './SafeImage';

/** Sentinel for variants with no assigned image */
const NO_IMAGE_KEY = '__no_image__';

interface StorePageProps {
  collection: CollectionType;
  initialCategory?: string;
  forceProductView?: boolean;
}

// View levels for hierarchical navigation
type ViewLevel = 'ROOT' | 'CATEGORY' | 'PRODUCT';

/** Extracted variant selector with memoized image grouping */
interface VariantSelectorProps {
  variants: ProductVariant[];
  selectedVariant: ProductVariant | undefined;
  activeImageGroupKey: string | null;
  onSelectVariant: (v: ProductVariant | undefined) => void;
  onSetGroupKey: (key: string | null) => void;
}

const VariantSelector: React.FC<VariantSelectorProps> = React.memo(({
  variants,
  selectedVariant,
  activeImageGroupKey,
  onSelectVariant,
  onSetGroupKey,
}) => {
  // Memoize image grouping so it only recalculates when variants change
  const { groupEntries, imageGroups, hasMultipleGroups } = useMemo(() => {
    const groups = new Map<string, ProductVariant[]>();
    variants.forEach(v => {
      const key = v.image || NO_IMAGE_KEY;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    });
    return {
      imageGroups: groups,
      groupEntries: Array.from(groups.entries()),
      hasMultipleGroups: groups.size > 1,
    };
  }, [variants]);

  // Determine active group: explicit key > selected variant's group > first group
  const resolvedGroupKey = activeImageGroupKey || (selectedVariant?.image || NO_IMAGE_KEY);
  const activeGroup = imageGroups.get(resolvedGroupKey) || groupEntries[0]?.[1] || [];
  const currentGroupKey = imageGroups.has(resolvedGroupKey) ? resolvedGroupKey : groupEntries[0]?.[0] || NO_IMAGE_KEY;

  // Variant button styles
  const variantBtnClass = (v: ProductVariant) =>
    `px-4 py-2 text-xs uppercase tracking-wider border transition-all rounded-sm ${
      selectedVariant?.id === v.id
        ? 'border-earth bg-earth text-cream'
        : v.inStock
          ? 'border-earth/20 text-earth hover:border-earth'
          : 'border-earth/10 text-earth/30 cursor-not-allowed line-through'
    }`;

  if (!hasMultipleGroups) {
    // Single group — flat buttons
    return (
      <>
        <span className="text-[10px] uppercase tracking-widest text-earth/50 block mb-3">Select Option</span>
        <div className="flex flex-wrap gap-2">
          {variants.map(v => (
            <button
              key={v.id}
              onClick={() => onSelectVariant(v.id === selectedVariant?.id ? undefined : v)}
              disabled={!v.inStock}
              className={variantBtnClass(v)}
            >
              {v.name}
            </button>
          ))}
        </div>
      </>
    );
  }

  // Multi-group — tier 1: image/color swatches, tier 2: size buttons
  return (
    <>
      {/* Tier 1: Color/Style */}
      <span className="text-[10px] uppercase tracking-widest text-earth/50 block mb-3">Select Style</span>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
        {groupEntries.map(([imageKey, groupVariants]) => {
          const isActive = currentGroupKey === imageKey;
          const hasImage = imageKey !== NO_IMAGE_KEY;
          const firstVariant = groupVariants[0];
          const anyInStock = groupVariants.some(v => v.inStock);

          return (
            <button
              key={imageKey}
              onClick={() => {
                onSetGroupKey(imageKey);
                if (selectedVariant && (selectedVariant.image || NO_IMAGE_KEY) !== imageKey) {
                  onSelectVariant(undefined);
                }
                if (groupVariants.length === 1) {
                  onSelectVariant(firstVariant);
                }
              }}
              disabled={!anyInStock}
              className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all duration-200
                ${isActive
                  ? 'border-earth ring-2 ring-earth/20 shadow-md scale-[1.02]'
                  : anyInStock
                    ? 'border-earth/15 hover:border-earth/40 hover:shadow-sm'
                    : 'border-earth/10 opacity-40 cursor-not-allowed'}`}
            >
              {hasImage ? (
                <SafeImage src={imageKey} alt={firstVariant.name} className="w-14 h-14 md:w-16 md:h-16 object-cover" />
              ) : (
                <div className="w-14 h-14 md:w-16 md:h-16 bg-earth/5 flex items-center justify-center text-[9px] text-earth/40 uppercase tracking-wider px-1 text-center">
                  {firstVariant.name.split(/[\s-]/)[0]}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Tier 2: Size/Option within selected group */}
      {activeGroup.length > 0 && (
        <>
          <span className="text-[10px] uppercase tracking-widest text-earth/50 block mb-3">
            {activeGroup.length === 1 ? 'Selected' : 'Select Size'}
          </span>
          <div className="flex flex-wrap gap-2">
            {activeGroup.map(v => (
              <button
                key={v.id}
                onClick={() => onSelectVariant(v.id === selectedVariant?.id ? undefined : v)}
                disabled={!v.inStock}
                className={variantBtnClass(v)}
              >
                {v.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
});
VariantSelector.displayName = 'VariantSelector';

export const StorePage: React.FC<StorePageProps> = ({ collection, initialCategory = 'All', forceProductView = false }) => {
  const { products, siteContent, isLoading } = useSite();
  const [sortOption, setSortOption] = useState<'newest' | 'price-asc' | 'price-desc'>('newest');

  // Find the configuration for this collection from the dynamic state
  const config = useMemo(() => {
    return siteContent.collections.find(c => c.id === collection) || {
      id: collection,
      title: collection.charAt(0).toUpperCase() + collection.slice(1),
      subtitle: 'Collection',
      heroImage: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=2000',
      subcategories: []
    };
  }, [siteContent.collections, collection]);

  // Decoded category from URL
  const selectedCategory = useMemo(() => decodeURIComponent(initialCategory), [initialCategory]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | undefined>(undefined);
  /** Tracks the active image group (color/style) independently from selectedVariant */
  const [activeImageGroupKey, setActiveImageGroupKey] = useState<string | null>(null);

  // Reset variant and group key when changing product
  const handleSelectProduct = (product: Product | null) => {
    setSelectedProduct(product);
    setSelectedVariant(undefined);
    setActiveImageGroupKey(null);
  };

  // Get main categories for logic checks
  const mainCategoriesForRedirect = useMemo(() => {
    const flagged = config.subcategories.filter(sub => sub.isMainCategory);
    return flagged.length > 0 ? flagged : config.subcategories;
  }, [config.subcategories]);

  // Auto-redirect to main category if there's only one (to show swimlane view immediately)
  // Skip this for 'kids' collection which has premium grid layout at root level
  React.useEffect(() => {
    if (collection === 'kids') return; // Don't auto-redirect for premium layout

    if (selectedCategory === 'All' && mainCategoriesForRedirect.length === 1) {
      const singleMain = mainCategoriesForRedirect[0];
      // Only redirect if this category has children (would show swimlanes)
      const hasChildren = config.subcategories.some(sub => sub.parentCategory === singleMain.title);
      if (hasChildren) {
        const newHash = `#collection/${collection}?cat=${encodeURIComponent(singleMain.title)}`;
        window.location.hash = newHash;
      }
    }
  }, [selectedCategory, mainCategoriesForRedirect, config.subcategories, collection]);

  // Compute the view level based on selected category and available data
  const viewLevel = useMemo<ViewLevel>(() => {
    if (selectedCategory === 'All') {
      return 'ROOT';
    }

    // Force product grid view when explicitly requested (e.g. "View All Girls")
    if (forceProductView) {
      return 'PRODUCT';
    }

    // Any category with children should show the CATEGORY view (hero slider + swimlanes)
    const hasChildren = config.subcategories.some(
      sub => sub.parentCategory === selectedCategory
    );

    if (hasChildren) {
      return 'CATEGORY';
    }

    return 'PRODUCT';
  }, [selectedCategory, config.subcategories, forceProductView]);

  // Get main categories (for ROOT view)
  // Fallback: if no categories have isMainCategory flag, show all subcategories
  const mainCategories = useMemo(() => {
    const flagged = config.subcategories.filter(sub => sub.isMainCategory);
    return flagged.length > 0 ? flagged : config.subcategories;
  }, [config.subcategories]);

  // Get child categories of the selected main category (for CATEGORY view)
  const childCategories = useMemo(() => {
    if (viewLevel !== 'CATEGORY') return [];
    return config.subcategories.filter(sub => sub.parentCategory === selectedCategory);
  }, [config.subcategories, selectedCategory, viewLevel]);

  // Filter products by collection
  const collectionProducts = useMemo(() => {
    return products.filter(p => p.collection === collection);
  }, [products, collection]);

  // Get products for a specific category (for previews and product grid)
  const getProductsForCategory = (categoryTitle: string, limit?: number) => {
    const filtered = collectionProducts.filter(p =>
      p.category === categoryTitle ||
      p.category.startsWith(categoryTitle + ' ')
    );
    return limit ? filtered.slice(0, limit) : filtered;
  };

  // Filter and Sort for PRODUCT view
  const filteredProducts = useMemo(() => {
    let result = collectionProducts;

    if (selectedCategory !== 'All') {
      // Improved partial matching: "Girls" matches "Girls Tops"
      result = result.filter(p =>
        p.category === selectedCategory ||
        p.category.startsWith(selectedCategory + ' ')
      );
    }

    return result.sort((a, b) => {
      if (sortOption === 'price-asc') return a.price - b.price;
      if (sortOption === 'price-desc') return b.price - a.price;
      return b.id.localeCompare(a.id);
    });
  }, [collectionProducts, selectedCategory, sortOption]);

  // Get unique categories for display in filter bar
  const categories = useMemo(() => {
    const cats = new Set(collectionProducts.map(p => p.category));
    const list = Array.from(cats);

    // Ensure defined subcategories are present
    config.subcategories.forEach(sub => {
      if (!list.includes(sub.title)) list.push(sub.title);
    });

    // Ensure currently selected category is in the list
    if (selectedCategory !== 'All' && !list.includes(selectedCategory)) {
      list.push(selectedCategory);
    }

    return ['All', ...list.sort()];
  }, [collectionProducts, selectedCategory, config.subcategories]);

  const handleCategoryChange = (cat: string) => {
    if (cat === selectedCategory) return;

    const subConfig = config.subcategories.find(c => c.title === cat);
    if (subConfig && subConfig.redirect) {
      window.location.hash = subConfig.redirect;
      return;
    }

    const newHash = cat === 'All'
      ? `#collection/${collection}`
      : `#collection/${collection}?cat=${encodeURIComponent(cat)}`;
    window.location.hash = newHash;
  };

  // Get back destination based on current view
  const getBackDestination = () => {
    if (viewLevel === 'CATEGORY') {
      // Navigate back to the parent category, or root if no parent
      const parentCat = config.subcategories.find(sub => sub.title === selectedCategory)?.parentCategory;
      return parentCat || 'All';
    }
    // For PRODUCT view, check if we came from a main category
    const parentCat = config.subcategories.find(sub => sub.title === selectedCategory)?.parentCategory;
    return parentCat || 'All';
  };

  // Render a product card (reusable for both preview and full grid)
  const ProductCard: React.FC<{ product: Product; index: number; compact?: boolean }> = ({ product, index, compact }) => (
    <FadeIn delay={index * 50} className="group cursor-pointer">
      <div
        className={`relative ${compact ? 'aspect-square' : 'aspect-[3/4]'} overflow-hidden bg-white mb-3 rounded-2xl shadow-sm hover:shadow-[0_20px_40px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all duration-500 border border-white/40 group`}
        onClick={() => handleSelectProduct(product)}
      >
        {product.isNew && !compact && (
          <span className="absolute top-2 left-2 bg-white/90 backdrop-blur-md px-2 py-1 text-[8px] uppercase tracking-widest text-earth z-10 rounded-sm shadow-sm border border-white/50">
            New
          </span>
        )}
        <SafeImage
          src={product.images[0]}
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105"
        />
        {/* Subtle Inner Glow Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        {!compact && (
          <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-500">
            <GlassButton
              variant="primary"
              size="sm"
              fullWidth
              className="py-3 text-[10px] bg-white/80 backdrop-blur-md shadow-lg border border-white/50 hover:bg-earth hover:text-white transition-colors duration-300"
            >
              Quick View
            </GlassButton>
          </div>
        )}
      </div>

      <div className={compact ? 'px-2' : 'px-1'}>
        <h3 className={`font-serif ${compact ? 'text-sm' : 'text-base'} text-earth leading-tight mb-1 group-hover:text-bronze transition-colors truncate`}>
          {product.name}
        </h3>
        <span className={`font-serif italic text-earth/80 ${compact ? 'text-sm' : 'text-base'} group-hover:text-bronze/80 transition-colors`}>${product.price}</span>
      </div>
    </FadeIn>
  );

  // Reusable Coming Soon newsletter signup for empty product views
  const ComingSoonSignup: React.FC = () => {
    const { addSubscriberWithTags } = useNewsletter();
    const [csEmail, setCsEmail] = useState('');
    const [csStatus, setCsStatus] = useState<'idle' | 'loading' | 'success'>('idle');

    const handleCsSubscribe = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!csEmail) return;
      setCsStatus('loading');

      const categoryTag = `category:${selectedCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
      await addSubscriberWithTags(csEmail, 'Guest', ['vip', 'early-access', categoryTag]);

      setCsStatus('success');
      setCsEmail('');
    };

    return (
      <form onSubmit={handleCsSubscribe} className="w-full max-w-sm mx-auto flex flex-col gap-6 mt-6">
        <div className="relative group w-full">
          <input
            type="email"
            value={csEmail}
            onChange={(e) => setCsEmail(e.target.value)}
            placeholder="Email Address"
            required
            className="w-full bg-transparent border-b border-white/20 pb-3 text-sm md:text-base text-white placeholder:text-white/30 focus:outline-none focus:border-white transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={csStatus === 'loading' || csStatus === 'success'}
          className="w-full bg-white text-stone-900 py-4 text-[10px] uppercase tracking-[0.25em] hover:bg-stone-200 transition-colors disabled:opacity-70 flex items-center justify-center gap-3 rounded-full font-medium mt-2 shadow-lg"
        >
          {csStatus === 'loading' ? 'Requesting Access...' : csStatus === 'success' ? <><Check className="w-4 h-4" /> Secured</> : 'Request Early Access'}
        </button>
      </form>
    );
  };

  // Subcategory box with product previews
  const SubcategoryWithPreviews: React.FC<{ category: Category; index: number }> = ({ category, index }) => {
    const previewProducts = getProductsForCategory(category.title, 4);
    const { addSubscriberWithTags } = useNewsletter();
    const [email, setEmail] = useState('');
    const [subStatus, setSubStatus] = useState<'idle' | 'loading' | 'success'>('idle');

    const handleSubscribe = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email) return;
      setSubStatus('loading');

      const categoryTag = `category:${category.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
      const success = await addSubscriberWithTags(email, 'Guest', ['vip', 'early-access', categoryTag]);

      if (success) {
        setSubStatus('success');
        setEmail('');
      } else {
        setSubStatus('idle');
        alert('Already subscribed!');
      }
    };

    return (
      <FadeIn delay={index * 100} className="mb-16">
        {/* Clean Section Header */}
        <div className="flex items-center justify-between mb-6 border-b border-earth/10 pb-2">
          <div
            className="group cursor-pointer flex items-center gap-3"
            onClick={() => handleCategoryChange(category.title)}
          >
            <h3 className="font-serif text-2xl md:text-3xl text-earth transition-colors group-hover:text-bronze">
              {category.title}
            </h3>
            <ArrowUpRight className="w-5 h-5 text-earth/30 transition-all group-hover:text-bronze group-hover:translate-x-1 group-hover:-translate-y-1" />
          </div>

          <button
            onClick={() => handleCategoryChange(category.title)}
            className="hidden md:flex items-center gap-2 text-xs uppercase tracking-widest text-earth/50 hover:text-earth transition-colors"
          >
            View All
          </button>
        </div>

        {/* Product Previews */}
        {previewProducts.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {previewProducts.map((product, idx) => (
              <ProductCard key={product.id} product={product} index={idx} compact />
            ))}
          </div>
        ) : (
          <div className="relative w-full max-w-3xl mx-auto rounded-[2rem] my-12 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.3)] group translate-y-0 hover:-translate-y-2 transition-transform duration-700">
            {/* Atmospheric Background Image */}
            <div
              className="absolute inset-0 w-full h-full bg-cover bg-center opacity-90 rounded-[2rem] transition-transform duration-1000"
              style={{
                backgroundImage: `url('/images/brand/hero-living.png')`,
              }}
            />
            <div className="absolute inset-0 bg-earth/40 rounded-[2rem]" />

            {/* Glassmorphic Floating Module */}
            <div className="relative z-10 w-full p-12 md:p-20 flex flex-col items-center justify-center text-center backdrop-blur-3xl bg-black/60 border border-white/20 shadow-2xl rounded-[2rem] overflow-hidden">
              {/* Subtle light effect inside the card */}
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/50 to-transparent" />
              <div className="absolute top-0 right-0 w-64 h-64 bg-bronze/20 rounded-full blur-3xl opacity-60 -z-10 translate-x-1/3 -translate-y-1/3" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/10 rounded-full blur-3xl opacity-50 -z-10 -translate-x-1/4 translate-y-1/4" />

              <h4 className="font-serif text-4xl md:text-5xl text-cream mb-4 tracking-tight drop-shadow-md">Coming Soon</h4>
              <p className="text-sm md:text-xs text-cream/70 uppercase tracking-[0.2em] mb-12 max-w-md mx-auto leading-relaxed font-light">
                Join the inner circle. Receive 24-hour early access to {category.title} drops before they open to the public.
              </p>

              <form onSubmit={handleSubscribe} className="w-full max-w-sm flex flex-col gap-6">
                <div className="relative group w-full">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email Address"
                    required
                    className="w-full bg-transparent border-b border-white/20 pb-3 text-sm md:text-base text-white placeholder:text-white/30 focus:outline-none focus:border-white transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={subStatus === 'loading' || subStatus === 'success'}
                  className="w-full bg-white text-stone-900 py-4 text-[10px] uppercase tracking-[0.25em] hover:bg-stone-200 transition-colors disabled:opacity-70 flex items-center justify-center gap-3 font-medium mt-2 rounded-full shadow-lg"
                >
                  {subStatus === 'loading' ? 'Requesting Access...' : subStatus === 'success' ? <><Check className="w-4 h-4" /> Secured</> : 'Request Early Access'}
                </button>
              </form>
            </div>
          </div>
        )}
      </FadeIn>
    );
  };

  // Hero Slider for the top of the Category Page
  const HeroProductSlider: React.FC<{ categoryTitle: string }> = ({ categoryTitle }) => {
    // Get newest/featured products for this category
    // In a real app, you might have a specific "featured" flag, but "newest" serves as a good proxy for "fresh"
    const featuredProducts = useMemo(() => {
      let prods = getProductsForCategory(categoryTitle);
      // Sort by newness/price or curate manually
      return prods.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)).slice(0, 8);
    }, [categoryTitle]);

    if (featuredProducts.length === 0) return null;

    return (
      <FadeIn className="mb-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-serif text-3xl md:text-5xl text-earth mb-3">
              {categoryTitle}
            </h2>
            <p className="text-xs uppercase tracking-widest text-earth/60">
              Latest Arrivals & Curated Picks
            </p>
          </div>
          <button
            onClick={() => {
              // Navigate to 'filtered' full view effectively, or scroll down (but filtering is better UX here)
              // Since we are ON the category page, "Shop All" usually implies just scrolling or seeing everything.
              // But for this specific "Shop All" button, let's make it go to the Product Grid View for the whole category.
              // The current viewLevel logic distinguishes CATEGORY (swimlanes) vs PRODUCT (grid).
              // We need a way to force PRODUCT view for "All Girls".

              // HACK: To force PRODUCT view for a main category, we can append a query param or change state.
              // However, our current route logic:
              // #collection/kids?cat=Girls -> Level 2 (Category View)
              // #collection/kids?cat=Girls%20All -> Level 3? No, that's messy.

              // Let's us just scroll to the first subcategory for now, or just let the user browse.
              // Actually, the user asked for "All Girls section... slide through products". 
              // This slider IS that section. The "View All" button is less critical if the slider shows the best stuff.

              // BETTER: Add a specific "Shop All" swimming lane at the bottom? 
              // OR: Just let them click subcategories.

              // Let's scroll to the first subcategory for now.
              const el = document.getElementById('sub-cats-start');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="hidden md:block text-xs uppercase tracking-widest text-bronze border-b border-bronze pb-1 hover:text-earth hover:border-earth transition-all"
          >
            Browse Collections ↓
          </button>
        </div>

        {/* Horizontal Slider Container */}
        <div className="flex overflow-x-auto gap-4 md:gap-6 pb-8 snap-x snap-mandatory scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
          {featuredProducts.map((product, idx) => (
            <div key={product.id} className="min-w-[260px] md:min-w-[300px] snap-center">
              <ProductCard product={product} index={idx} />
            </div>
          ))}

          {/* "View All" Card at the end of slider */}
          <div className="min-w-[200px] md:min-w-[240px] snap-center flex items-center justify-center">
            <button
              onClick={() => {
                window.location.hash = `#collection/${collection}?cat=${encodeURIComponent(categoryTitle)}&view=products`;
              }}
              className="group flex flex-col items-center gap-4 text-earth/50 hover:text-earth transition-colors"
            >
              <div className="w-16 h-16 rounded-full border border-earth/20 flex items-center justify-center group-hover:border-earth transition-colors">
                <ArrowUpRight className="w-6 h-6" />
              </div>
              <span className="text-xs uppercase tracking-widest">View All {categoryTitle}</span>
            </button>
          </div>
        </div>
      </FadeIn>
    );
  };

  return (
    <div className="bg-cream min-h-screen pt-20">

      {/* Unified Header Section - Clean cream background with centered title for all collections */}
      <section className={`relative transition-all duration-700 w-full ${viewLevel === 'ROOT' ? 'min-h-screen' : ''} flex flex-col`}>

        {/* Background */}
        <div className="absolute inset-0 bg-cream z-0"></div>

        {/* Header Title - Unified layout matching Kids for all collections */}
        {viewLevel === 'ROOT' && (
          <>
            <div className="relative z-30 pt-32 pb-8 md:pb-12 text-center bg-transparent pointer-events-none">
              <FadeIn>
                <h1 className="font-serif text-5xl md:text-7xl text-earth drop-shadow-sm mb-4 mix-blend-multiply opacity-90">
                  {config.title}
                </h1>
                <p className="font-sans text-earth/80 text-[10px] md:text-sm uppercase tracking-[0.3em] px-8 max-w-xs md:max-w-none mx-auto">
                  {config.subtitle}
                </p>
              </FadeIn>
            </div>

            {/* Category Cards */}
            <div className="pb-16 md:pb-24">
              {mainCategories.length <= 5 ? (
                <>
                  {/* ≤5 categories: Mobile Horizontal Scroll */}
                  <div className="md:hidden">
                    <div className="relative">
                      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-cream to-transparent z-10 pointer-events-none" />
                      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-cream to-transparent z-10 pointer-events-none" />

                      <div
                        className="flex gap-4 overflow-x-auto scrollbar-hide px-8 pb-4 scroll-smooth"
                        style={{
                          scrollSnapType: 'x mandatory',
                          WebkitOverflowScrolling: 'touch',
                          perspective: '1200px',
                        }}
                      >
                        {mainCategories.map((cat, idx, arr) => {
                          const centerIdx = (arr.length - 1) / 2;
                          const offset = idx - centerIdx;
                          const rotateY = Math.max(-12, Math.min(12, offset * 4));
                          const translateZ = Math.min(0, Math.abs(offset) * -8);

                          return (
                            <button
                              key={cat.id}
                              onClick={() => {
                                if (cat.redirect) {
                                  window.location.hash = cat.redirect.replace('#', '');
                                } else {
                                  handleCategoryChange(cat.title);
                                }
                              }}
                              className="
                                group relative flex-shrink-0 overflow-hidden rounded-2xl
                                w-[200px] aspect-[3/4]
                                bg-stone-100 
                                shadow-lg hover:shadow-2xl
                                transition-all duration-500 ease-out
                                hover:scale-[1.02]
                              "
                              style={{
                                transform: `rotateY(${rotateY}deg) translateZ(${translateZ}px)`,
                                transformStyle: 'preserve-3d',
                                scrollSnapAlign: 'center',
                              }}
                            >
                              <img
                                src={cat.image}
                                alt={cat.title}
                                className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
                                style={{ opacity: 0 }}
                                onLoad={(e) => { (e.target as HTMLImageElement).style.opacity = '1'; }}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                              <div className="absolute inset-0 flex flex-col justify-end items-center text-center p-6">
                                <h3 className="font-serif text-lg text-white font-light tracking-wide mb-2 whitespace-nowrap">
                                  {cat.title}
                                </h3>
                                <p className="text-white/70 text-xs uppercase tracking-[0.2em]">
                                  {cat.caption || 'Shop Now'}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ≤5 categories: Desktop Full-Frame Grid */}
                  <div className="hidden md:block px-8">
                    <div className="container mx-auto">
                      <div
                        className={`grid gap-6 ${mainCategories.length <= 3 ? 'grid-cols-3' :
                          mainCategories.length <= 4 ? 'grid-cols-4' :
                            'grid-cols-5'
                          }`}
                        style={{ perspective: '1200px' }}
                      >
                        {mainCategories.map((cat, idx, arr) => {
                          const centerIdx = (arr.length - 1) / 2;
                          const offset = idx - centerIdx;
                          const rotateY = offset * 8;
                          const translateZ = Math.abs(offset) * -20;

                          return (
                            <button
                              key={cat.id}
                              onClick={() => {
                                if (cat.redirect) {
                                  window.location.hash = cat.redirect.replace('#', '');
                                } else {
                                  handleCategoryChange(cat.title);
                                }
                              }}
                              className="
                                group relative overflow-hidden rounded-2xl
                                aspect-[2/3]
                                bg-stone-100 
                                shadow-lg hover:shadow-2xl
                                transition-all duration-500 ease-out
                                hover:scale-[1.02]
                              "
                              style={{
                                transform: `rotateY(${rotateY}deg) translateZ(${translateZ}px)`,
                                transformStyle: 'preserve-3d',
                              }}
                            >
                              <img
                                src={cat.image}
                                alt={cat.title}
                                className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
                                style={{ opacity: 0 }}
                                onLoad={(e) => { (e.target as HTMLImageElement).style.opacity = '1'; }}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                              <div className="absolute inset-0 flex flex-col justify-end items-center text-center p-6">
                                <h3 className="font-serif text-lg lg:text-xl text-white font-light tracking-wide mb-1 leading-tight whitespace-nowrap">
                                  {cat.title}
                                </h3>
                                <p className="text-white/70 text-xs uppercase tracking-[0.2em]">
                                  {cat.caption || 'Shop Now'}
                                </p>
                              <div className="mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                  <span className="inline-flex items-center text-white text-sm bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
                                    Explore
                                    <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                    </svg>
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* >5 categories: Slidable Horizontal Carousel with grid-matched card sizes */
                <div className="relative">
                  {/* Peek fade effect */}
                  <div className="absolute left-0 top-0 bottom-0 w-8 md:w-16 bg-gradient-to-r from-cream to-transparent z-10 pointer-events-none" />
                  <div className="absolute right-0 top-0 bottom-0 w-8 md:w-16 bg-gradient-to-l from-cream to-transparent z-10 pointer-events-none" />

                  <div
                    className="flex gap-4 md:gap-6 overflow-x-auto scrollbar-hide px-8 md:px-16 pb-4 scroll-smooth"
                    style={{
                      scrollSnapType: 'x mandatory',
                      WebkitOverflowScrolling: 'touch',
                      perspective: '1200px',
                    }}
                  >
                    {mainCategories.map((cat, idx, arr) => {
                      const centerIdx = (arr.length - 1) / 2;
                      const offset = idx - centerIdx;
                      const rotateY = Math.max(-12, Math.min(12, offset * 4));
                      const translateZ = Math.min(0, Math.abs(offset) * -8);

                      return (
                        <button
                          key={cat.id}
                          onClick={() => {
                            if (cat.redirect) {
                              window.location.hash = cat.redirect.replace('#', '');
                            } else {
                              handleCategoryChange(cat.title);
                            }
                          }}
                          className="
                            group relative flex-shrink-0 overflow-hidden rounded-2xl
                            w-[200px] md:w-[calc((100vw-10rem)/5)] lg:w-[calc((1024px-10rem)/5)] xl:w-[calc((1280px-10rem)/5)]
                            aspect-[3/4] md:aspect-[2/3]
                            bg-stone-100 
                            shadow-lg hover:shadow-2xl
                            transition-all duration-500 ease-out
                            hover:scale-[1.02]
                          "
                          style={{
                            transform: `rotateY(${rotateY}deg) translateZ(${translateZ}px)`,
                            transformStyle: 'preserve-3d',
                            scrollSnapAlign: 'center',
                          }}
                        >
                          <img
                            src={cat.image}
                            alt={cat.title}
                            className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
                            style={{ opacity: 0 }}
                            onLoad={(e) => { (e.target as HTMLImageElement).style.opacity = '1'; }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                          <div className="absolute inset-0 flex flex-col justify-end items-center text-center p-6 md:p-8">
                            <h3 className="font-serif text-xl md:text-lg lg:text-xl text-white font-light tracking-wide mb-2 whitespace-nowrap">
                              {cat.title}
                            </h3>
                            <p className="text-white/70 text-xs md:text-sm uppercase tracking-[0.2em]">
                              {cat.caption || 'Shop Now'}
                            </p>
                            <div className="mt-3 md:mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                              <span className="inline-flex items-center text-white text-xs md:text-sm">
                                Explore
                                <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                </svg>
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* --- LEVEL 1: ROOT VIEW - New Arrivals Feed (Kids) --- */}
      {viewLevel === 'ROOT' && collection === 'kids' && (
        <section className="px-4 md:px-8 pb-12 md:pb-16 -mt-8 relative z-30">
          {/* Negative margin to pull it up into the concave scoop if needed, but let's keep it safe below */}
          <div className="container mx-auto">
            <FadeIn className="mb-8 text-center md:text-left">
              <h2 className="font-serif text-3xl md:text-4xl text-earth mb-3 ml-2">New Arrivals</h2>
              <p className="text-xs uppercase tracking-widest text-earth/50 ml-2">
                Latest collections for the little ones
              </p>
            </FadeIn>

            <div className="flex overflow-x-auto gap-4 md:gap-6 pb-8 snap-x snap-mandatory scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
              {collectionProducts.slice(0, 8).map((product, idx) => (
                <div key={product.id} className="min-w-[260px] md:min-w-[300px] snap-center">
                  <ProductCard product={product} index={idx} />
                </div>
              ))}

              <div className="min-w-[200px] md:min-w-[240px] snap-center flex items-center justify-center">
                <button
                  onClick={() => handleCategoryChange('All')}
                  className="group flex flex-col items-center gap-4 text-earth/50 hover:text-earth transition-colors"
                >
                  <div className="w-16 h-16 rounded-full border border-earth/20 flex items-center justify-center group-hover:border-earth transition-colors">
                    <ArrowUpRight className="w-6 h-6" />
                  </div>
                  <span className="text-xs uppercase tracking-widest">Shop All {config.title}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* --- LEVEL 2: CATEGORY VIEW - Subcategories with Product Previews --- */}
      {viewLevel === 'CATEGORY' && (
        <>
          {/* Back Button */}
          <div className="sticky top-[73px] z-30 bg-cream/95 backdrop-blur-md border-b border-earth/10 px-4 md:px-8 py-4">
            <div className="container mx-auto flex items-center justify-between">
              <button
                onClick={() => handleCategoryChange(getBackDestination())}
                className="text-[10px] uppercase tracking-widest text-earth/50 hover:text-earth flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> Back to {config.title}
              </button>
            </div>
          </div>

          <section className="px-4 md:px-8 py-12 md:py-16">
            <div className="container mx-auto">

              {/* NEW: Hero Slider at the Top */}
              <HeroProductSlider categoryTitle={selectedCategory} />

              <div id="sub-cats-start" className="h-px w-full bg-earth/10 mb-16"></div>

              {/* Subcategory Swimlanes */}
              {childCategories.map((cat, idx) => (
                <SubcategoryWithPreviews key={cat.id} category={cat} index={idx} />
              ))}
            </div>
          </section>
        </>
      )}

      {/* --- LEVEL 3: PRODUCT VIEW - Full Product Grid --- */}
      {viewLevel === 'PRODUCT' && (
        <>
          {/* Filter & Toolbar */}
          <div className="sticky top-[73px] z-30 bg-gradient-to-r from-[#1a130a]/95 via-[#2d1f12]/95 to-[#1a130a]/95 backdrop-blur-3xl border-b border-white/10 px-4 md:px-8 py-4 transition-all duration-300 shadow-xl">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
            <div className="container mx-auto flex flex-col md:flex-row justify-between items-center gap-4 relative z-10">
              <div className="flex items-center gap-4 md:gap-6 overflow-x-auto no-scrollbar w-full md:w-auto pb-2 md:pb-0">
                <button
                  onClick={() => handleCategoryChange(getBackDestination())}
                  className="whitespace-nowrap text-[10px] uppercase tracking-widest text-cream/50 hover:text-cream flex items-center gap-1 group transition-colors"
                >
                  <div className="bg-white/5 border border-white/10 p-1.5 rounded-full group-hover:bg-white/10 transition-colors">
                    <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                  </div>
                  Back
                </button>
                <div className="h-6 w-px bg-white/10 mx-2 hidden md:block"></div>
                {categories.slice(0, 8).map(cat => (
                  <button
                    key={cat}
                    onClick={() => handleCategoryChange(cat)}
                    className={`whitespace-nowrap text-[10px] uppercase tracking-widest transition-all duration-300 px-3 py-1.5 rounded-full ${selectedCategory === cat ? 'bg-white/10 text-cream border border-white/20 shadow-inner' : 'text-cream/50 hover:text-cream hover:bg-white/5 border border-transparent'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 ml-auto md:ml-0 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full backdrop-blur-md">
                <span className="text-[10px] uppercase tracking-widest text-cream/50">Sort By:</span>
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as any)}
                  className="bg-transparent text-[10px] uppercase tracking-widest text-bronze focus:outline-none cursor-pointer appearance-none ml-1 font-medium"
                >
                  <option value="newest" className="bg-stone-900 text-cream">Newest</option>
                  <option value="price-asc" className="bg-stone-900 text-cream">Price: Low to High</option>
                  <option value="price-desc" className="bg-stone-900 text-cream">Price: High to Low</option>
                </select>
              </div>
            </div>
          </div>

          <section className="px-4 md:px-8 py-12 md:py-16 min-h-[60vh]">
            <div className="container mx-auto">
              {filteredProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 animate-fade-in-up md:min-h-[60vh]">
                  <div className="relative w-full max-w-3xl mx-auto rounded-[2rem] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.3)] translate-y-0 hover:-translate-y-2 transition-transform duration-700">
                    {/* Atmospheric Parallax Background Image */}
                    <div
                      className="absolute inset-0 w-full h-full bg-cover bg-center opacity-90 rounded-[2rem]"
                      style={{
                        backgroundImage: `url('/images/brand/hero-living.png')`,
                        backgroundAttachment: 'fixed'
                      }}
                    />
                    <div className="absolute inset-0 bg-earth/40 rounded-[2rem]" />

                    {/* Glassmorphic Floating Module */}
                    <div className="relative z-10 w-full p-12 md:p-24 flex flex-col items-center justify-center text-center backdrop-blur-2xl bg-earth/15 border border-white/10 rounded-[2rem]">
                      {/* Subtle light effect inside the card */}
                      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl opacity-50 -z-10 translate-x-1/3 -translate-y-1/3" />

                      <h3 className="font-serif text-4xl md:text-6xl text-white mb-6 tracking-tight">Coming Soon</h3>
                      <p className="text-sm md:text-xs text-white/60 uppercase tracking-[0.2em] mb-12 max-w-md mx-auto font-light leading-relaxed">
                        Join the inner circle. Receive 24-hour early access to {selectedCategory} drops before they open to the public.
                      </p>

                      <ComingSoonSignup />

                      <button onClick={() => handleCategoryChange(getBackDestination())} className="mt-16 text-[9px] uppercase tracking-[0.2em] text-white/50 border-b border-white/30 pb-1 hover:text-white hover:border-white transition-colors z-20 relative">
                        Return to Collections
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
                  {filteredProducts.map((product, idx) => (
                    <FadeIn key={product.id} delay={idx * 50} className="group cursor-pointer">
                      <div
                        className="relative aspect-[3/4] overflow-hidden bg-white mb-4 rounded-sm"
                        onClick={() => handleSelectProduct(product)}
                      >
                        {product.isNew && (
                          <span className="absolute top-3 left-3 bg-white/90 px-2 py-1 text-[9px] uppercase tracking-widest text-earth z-10 rounded-sm">
                            New
                          </span>
                        )}
                        {product.variants && product.variants.length > 0 && (
                          <span className="absolute top-3 right-3 bg-bronze/90 px-2 py-1 text-[9px] uppercase tracking-widest text-white z-10 rounded-sm">
                            Multiple Options
                          </span>
                        )}
                        <SafeImage
                          src={product.images[0]}
                          alt={product.name}
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
                        <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                          <button className="w-full bg-white/90 backdrop-blur-sm text-earth py-3 text-[10px] uppercase tracking-[0.2em] hover:bg-earth hover:text-white transition-colors shadow-lg">
                            Quick View
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-serif text-lg text-earth leading-tight mb-1 group-hover:text-bronze transition-colors">
                            {product.name}
                          </h3>
                          <p className="text-[10px] uppercase tracking-widest text-earth/50">{product.category}</p>
                        </div>
                        <span className="font-serif italic text-earth text-lg">${product.price}</span>
                      </div>
                    </FadeIn>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* Product Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-8">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => handleSelectProduct(null)}></div>

          <div className="bg-cream w-full max-w-5xl h-[90vh] md:h-auto md:max-h-[85vh] rounded-sm shadow-2xl relative flex flex-col md:flex-row overflow-hidden animate-fade-in-up">
            <button
              onClick={() => handleSelectProduct(null)}
              className="absolute top-4 right-4 z-20 p-2 bg-white/50 hover:bg-white rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-earth" />
            </button>
            <div className="w-full md:w-1/2 bg-white h-1/2 md:h-auto overflow-hidden relative group">
              <SafeImage
                src={selectedVariant?.image || (activeImageGroupKey && activeImageGroupKey !== NO_IMAGE_KEY ? activeImageGroupKey : selectedProduct.images[0])}
                alt={selectedProduct.name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="w-full md:w-1/2 p-6 md:p-10 overflow-y-auto bg-cream flex flex-col">
              <div className="mb-auto">
                <div className="flex items-center gap-3 mb-4 text-[10px] uppercase tracking-widest text-earth/50">
                  <span>{config.title}</span>
                  <span className="w-1 h-1 bg-bronze rounded-full"></span>
                  <span>{selectedProduct.category}</span>
                </div>
                <h2 className="font-serif text-2xl md:text-4xl text-earth mb-4 leading-tight">{selectedProduct.name}</h2>
                <p className="font-serif text-xl md:text-2xl italic text-bronze mb-6">
                  ${(selectedProduct.price + (selectedVariant?.priceAdjustment || 0)).toFixed(2)}
                </p>
                <div className="h-px w-full bg-earth/10 mb-6"></div>

                {/* Variant Selector — Two-tier: Color/Style swatches → Size pills */}
                {selectedProduct.variants && selectedProduct.variants.length > 0 && (
                  <div className="mb-6">
                    <VariantSelector
                      variants={selectedProduct.variants}
                      selectedVariant={selectedVariant}
                      activeImageGroupKey={activeImageGroupKey}
                      onSelectVariant={setSelectedVariant}
                      onSetGroupKey={setActiveImageGroupKey}
                    />
                  </div>
                )}

                <p className="font-sans text-earth/70 leading-relaxed mb-6 text-sm">{selectedProduct.description}</p>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-2 text-xs text-green-700">
                    <span className="w-2 h-2 rounded-full bg-green-600"></span>
                    {selectedProduct.inStock ? 'In Stock & Ready to Ship' : 'Made to Order'}
                  </div>
                </div>
              </div>
              <AddToCartButton
                product={selectedProduct}
                selectedVariant={selectedVariant}
                variantRequired={!!(selectedProduct.variants && selectedProduct.variants.length > 0)}
                className="mt-6"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
