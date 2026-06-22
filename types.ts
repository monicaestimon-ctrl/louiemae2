
export type CollectionType = string; // Was 'furniture' | 'decor' | ... now dynamic

import type { Id } from './convex/_generated/dataModel';

export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  images: string[];
  category: string;
  collection: CollectionType;
  isNew?: boolean;
  inStock?: boolean;
  variants?: ProductVariant[];  // Optional - for products with color/size options
  // CJ Sourcing fields
  sourceUrl?: string;
  cjSourcingStatus?: 'pending' | 'approved' | 'rejected' | 'none';
  cjVariantId?: string;
  cjSku?: string;
  publishedAt?: string; // ISO date string — used for 30-day auto-expire on New Arrivals
  // Two-stage pricing metadata
  sourcePriceCny?: number;        // Original 1688 factory price (CNY)
  estimatedCjCost?: number;       // Estimated CJ cost (1688 × 1.4, USD)
  estimatedShipping?: number;     // Estimated shipping (category-based)
  confirmedCjCost?: number;       // Actual CJ cost after sourcing approval
  estimatedCjProductCost?: number;
  estimatedCjShippingCost?: number;
  estimatedCjServiceFee?: number;
  estimatedLandedCost?: number;
  confirmedCjProductCost?: number;
  confirmedCjShippingCost?: number;
  confirmedCjServiceFee?: number;
  confirmedCjTaxesFee?: number;
  confirmedCjClearanceFee?: number;
  confirmedCjRemoteFee?: number;
  confirmedCjLogisticsName?: string;
  confirmedLandedCost?: number;
  suggestedRetailPrice?: number;
  adminPriceLocked?: boolean;
  pricingSource?: 'source_estimate' | 'cj_catalog_confirmed' | 'cj_freight_confirmed' | 'manual_locked' | 'order_reconciled';
  pricingUpdatedAt?: number;
  pricingWarnings?: string[];
  pricingStage?: 'estimated' | 'confirmed';
  // Currency conversion metadata
  sourceCurrency?: string;          // Original currency code (e.g. 'GBP', 'CNY')
  sourcePriceOriginal?: number;     // Original price in source currency
  rawSourceDescription?: string;    // Cleaned source detail text for smart descriptions
  rawHtmlDescription?: string;      // Raw source detail HTML for smart descriptions
  descriptionImages?: string[];     // Source detail/marketing images for smart descriptions
  // Multi-category
  subcategory?: string;           // Specific subcategory (e.g., "Skirts")
  smartDescription?: {
    description: string;
    auditId: Id<'descriptionAudits'>;
    generatedAt: number;
    model: string;
    promptVersion: string;
    sourceSnapshotHash: string;
    adminEdited: boolean;
    status: 'generated' | 'edited' | 'approved' | 'failed' | 'fallback';
  };
  descriptionSource?:
    | 'admin_written'
    | 'ai_generated'
    | 'ai_generated_admin_edited'
    | 'source_original'
    | 'safe_fallback';
  descriptionFingerprint?: {
    normalizedOpening: string;
    topPhrases: string[];
    productType: string;
    collection: string;
  };
}

export interface Category {
  id: string;
  title: string;
  image: string;
  caption?: string;
  collection?: CollectionType;
  redirect?: string; // For cross-linking (e.g. Decor > Accent Chairs -> Furniture)
  parentCategory?: string;    // Parent category title for hierarchy (e.g., "Girls" for "Girls Dresses")
  isMainCategory?: boolean;   // True for top-level categories like "Girls", "Boys"
}

export interface CollectionConfig {
  id: string; // e.g., 'furniture'
  title: string;
  subtitle: string;
  heroImage: string;
  subcategories: Category[]; // Defines the sub-menu and filter options
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}

export interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  image: string;
  category: string;
  status: 'published' | 'draft';
}

export interface NavLink {
  label: string;
  href: string;
  children?: NavLink[];
}

export interface SectionItem {
  image?: string;
  title?: string;
  subtitle?: string;
  link?: string;
}

export interface PageSection {
  id: string;
  type: 'hero' | 'text' | 'image-text' | 'manifesto' | 'grid' | 'full-image' | 'product-feature';
  heading?: string;
  subheading?: string;
  content?: string;
  image?: string;
  items?: SectionItem[]; // For grids
  productId?: string; // For product features
  layout?: 'left' | 'right' | 'center';
}

export interface HomePageContent {
  hero: {
    image: string;
    pretitle: string;
    titleLine1: string;
    titleLine2: string;
    buttonText: string;
  };
  intro: {
    text: string;
  };
  categoryImages: {
    furniture: string;
    decor: string;
    fashion: string;
    kids: string;
    journal: string;
  };
  brand: {
    image: string;
  };
  shop: {
    headerImage: string;
  };
  sections: PageSection[]; // Dynamic sections added via admin
}

export interface StoryPageContent {
  hero: {
    image: string;
    title: string;
    subtitle: string;
  };
  prologue: {
    quote: string;
    subtext: string;
  };
  chapters: {
    oneTitle: string;
    oneText: string;
    twoTitle: string;
    twoText: string;
    threeTitle: string;
    threeText: string;
    fourTitle: string;
    fourText: string;
  };
  sections?: PageSection[]; // Dynamic sections added via admin
}

export interface CustomPage {
  id: string;
  title: string;
  slug: string;
  sections: PageSection[];
}

export interface SiteContent {
  navLinks: NavLink[];
  collections: CollectionConfig[];
  home: HomePageContent;
  story: StoryPageContent;
  customPages: CustomPage[];
}

// --- Newsletter Types ---

export interface Subscriber {
  id: string;
  email: string;
  firstName?: string;
  dateSubscribed: string;
  status: 'active' | 'unsubscribed';
  tags: string[]; // e.g. 'vip', 'cart-abandoned', 'welcome-series'
  openRate: number; // Mocked percentage 0-100
}

export interface EmailCampaign {
  id: string;
  subject: string;
  previewText: string;
  content: string; // HTML or Markdown
  status: 'draft' | 'scheduled' | 'sent';
  sentDate?: string;
  stats: {
    sent: number;
    opened: number;
    clicked: number;
  };
  type: 'newsletter' | 'promotion' | 'automation';
}

// --- Product Sourcing API Types (OTAPI 1688) ---

export interface ProductVariant {
  id: string;
  name: string; // e.g., "Color: Cream" or "Size: M"
  image?: string;
  priceAdjustment: number; // +/- from base price
  inStock: boolean;
  /** Explicit selling-price override set on the final review page (bypasses rounding). */
  sellingPriceOverride?: number;
  // CJ fulfillment mapping - links to CJ variant for correct fulfillment
  cjVariantId?: string;  // CJ vid for this variant
  cjSku?: string;         // CJ SKU for this variant
}

export type ProductSource = '1688' | 'generic';

export interface SourceProduct extends Product {
  sourceId: string;
  originalPrice: number;
  salePrice: number;
  shippingInfo: {
    freeShipping: boolean;
    estimatedDays: string;
    cost: number;
  };
  seller: {
    id: string;
    name: string;
    rating: number;
    feedbackScore: number;
  };
  variants: ProductVariant[];
  tierPricing?: Array<{ minQty: number; price: number }>;
  reviewCount: number;
  averageRating: number;
  productUrl: string;
  source?: ProductSource;
  /** Structured product attributes extracted from OTAPI (material, season, style, etc.) */
  sourceProperties?: Record<string, string>;
  /** Cleaned source listing/detail text used for smart description generation. */
  rawSourceDescription?: string;
  /** Raw source listing/detail HTML used for source normalization and image/detail context. */
  rawHtmlDescription?: string;
}

/** @deprecated Use SourceProduct instead */
export type AliExpressProduct = SourceProduct;

export interface SourceSearchOptions {
  query: string;
  page?: number;
  pageSize?: number;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  sortBy?: 'price_asc' | 'price_desc' | 'orders' | 'rating';
  categoryId?: string;
}

/** @deprecated Use SourceSearchOptions instead */
export type AliExpressSearchOptions = SourceSearchOptions;

export interface SourceSearchResult {
  products: SourceProduct[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
}

/** @deprecated Use SourceSearchResult instead */
export type AliExpressSearchResult = SourceSearchResult;

export interface ImportedProduct extends Product {
  sourceId: string;
  originalCost: number;
  markup: number;
  importedAt: string;
  lastSyncedAt: string;
  autoSync: boolean;
}
