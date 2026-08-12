
import React, { useState, useRef } from 'react';
import { useAction, useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { useSite } from '../contexts/BlogContext';
import { RichTextEditor } from './RichTextEditor';
import { useNewsletterAdmin } from '../contexts/NewsletterContext';
import { FadeIn } from './FadeIn';
import { Plus, Edit3, Trash2, LogOut, X, Image as ImageIcon, Layout, ArrowLeft, PenTool, BookOpen, Home, Settings, Wand2 as WandIcon, Loader2, FileText, ShoppingBag, Tag, ChevronDown, Layers, Menu, Upload, Grid, Maximize, Type, Mail, Users, Send, BarChart2, Package, Lock, ChevronLeft, ExternalLink, Search, Eye, EyeOff, Rocket, RefreshCw } from 'lucide-react';
import { BlogPost, CustomPage, PageSection, Product, CollectionType, CollectionConfig, EmailCampaign } from '../types';
import { AdminOrders } from './AdminOrders';
import { NewsletterStudio } from './NewsletterStudio';
import { ProductStudio } from './ProductStudio';
import { ProductImport } from './ProductImport';
import { CJSettings } from './CJSettings';
import { CJControlRoom } from './CJControlRoom';
import { CJRiskCheck } from './CJRiskCheck';
import { buildSourceProductSnapshot } from '../lib/smartDescription';
import { SafeImage } from './SafeImage';
import { productStorefrontStatusLabel } from '../lib/productVisibility';

type SmartDescriptionActionResult = {
   ok: boolean;
   description?: string;
   auditId?: string;
   fallbackUsed?: boolean;
   warnings?: string[];
   facts?: { sourceQuality?: { score?: number } };
   error?: string;
};

type AdminTab =
   | 'dashboard'
   | 'journal'
   | 'pages'
   | 'products'
   | 'structure'
   | 'newsletter'
   | 'orders'
   | 'cj-control-room'
   | 'cj-risk-check'
   | 'import'
   | 'cj-settings';

type CjAdminNavTarget = 'cj-settings' | 'cj-control-room' | 'cj-risk-check';
type CjAdminNavRequest = CjAdminNavTarget | {
   tab: CjAdminNavTarget;
   orderId?: string;
   productId?: string;
};

// --- Image Uploader Component ---
const ImageUploader: React.FC<{
   currentImage?: string;
   onImageChange: (val: string) => void;
   label?: string;
   className?: string;
   aspectRatio?: string;
}> = ({ currentImage = '', onImageChange, label = 'Image', className = '', aspectRatio = 'aspect-[3/4]' }) => {
   const fileInputRef = useRef<HTMLInputElement>(null);
   const [isUploading, setIsUploading] = useState(false);
   const [previewUrl, setPreviewUrl] = useState<string | null>(null);
   const generateUploadUrl = useMutation(api.files.generateUploadUrl);
   const saveFile = useMutation(api.files.saveFile);

   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
         alert('Image must be less than 5MB');
         return;
      }

      setIsUploading(true);

      // Show immediate preview from local file
      const reader = new FileReader();
      reader.onloadend = () => {
         setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);

      try {
         // Upload to Convex file storage
         const uploadUrl = await generateUploadUrl();
         const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': file.type },
            body: file,
         });

         if (!response.ok) throw new Error('Upload failed');

         const { storageId } = await response.json();

         // Get the public URL via server-side mutation
         const result = await saveFile({
            storageId,
            fileName: file.name,
            fileType: file.type,
            purpose: 'blog',
         });

         if (result.url) {
            onImageChange(result.url);
         } else {
            throw new Error('No URL returned from storage');
         }
      } catch (error) {
         console.error('Upload error:', error);
         // Fallback to base64 if upload fails
         if (previewUrl) {
            onImageChange(previewUrl);
         }
         alert('Image upload to cloud failed. Image saved locally as fallback.');
      } finally {
         setIsUploading(false);
      }
   };

   const displayImage = previewUrl || currentImage;

   return (
      <div className={className}>
         <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">{label}</label>
         <div className="flex gap-6 items-start">
            <div
               className={`w-32 ${aspectRatio} bg-cream/50 border border-earth/10 flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80 transition-opacity rounded-sm shadow-sm flex-shrink-0 relative group`}
               onClick={() => !isUploading && fileInputRef.current?.click()}
            >
               {isUploading ? (
                  <Loader2 className="w-6 h-6 text-bronze animate-spin" />
               ) : displayImage ? (
                  <SafeImage src={displayImage} alt="Preview" className="w-full h-full object-cover" />
               ) : (
                  <ImageIcon className="w-8 h-8 text-earth/20" />
               )}
               {!isUploading && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                     <Upload className="w-6 h-6 text-white drop-shadow-md" />
                  </div>
               )}
            </div>
            <div className="flex-1 space-y-3 pt-2">
               <div className="flex flex-col gap-2">
                  <button
                     onClick={() => !isUploading && fileInputRef.current?.click()}
                     disabled={isUploading}
                     className="w-full sm:w-auto text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 bg-white border border-earth/10 px-4 py-3 hover:bg-earth hover:text-white transition-colors shadow-sm disabled:opacity-50"
                  >
                     {isUploading ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Uploading...</>
                     ) : (
                        <><Upload className="w-3 h-3" /> Upload Photo from Computer</>
                     )}
                  </button>
                  <input
                     type="file"
                     ref={fileInputRef}
                     className="hidden"
                     accept="image/*"
                     onChange={handleFileChange}
                  />
               </div>
               <div className="relative">
                  <span className="absolute top-1/2 -translate-y-1/2 left-0 text-[9px] uppercase tracking-widest text-earth/30">OR</span>
                  <input
                     type="text"
                     value={currentImage}
                     onChange={(e) => onImageChange(e.target.value)}
                     className="w-full bg-transparent border-b border-earth/10 py-2 pl-8 text-xs font-mono text-earth/60 focus:outline-none focus:border-bronze placeholder:text-earth/20"
                     placeholder="Paste Image URL"
                  />
               </div>
            </div>
         </div>
      </div>
   );
};

export const AdminPage: React.FC = () => {
   const { isAuthenticated, isAuthLoading, signIn, logout, posts, addPost, updatePost, deletePost, siteContent, updateSiteContent, addCustomPage, updateCustomPage, deleteCustomPage, products, addProduct, updateProduct, deleteProduct, addCollection, updateCollection, deleteCollection } = useSite();
   const { subscribers, campaigns, createCampaign, updateCampaign, sendCampaign, deleteCampaign, stats } = useNewsletterAdmin();
   const linkDescriptionAuditToProduct = useMutation(api.descriptionAudits.linkAuditToProduct);
   const launchNextProducts = useMutation(api.products.launchNextProducts);
   const generateSmartDescription = useAction(api.smartDescriptions.generateSmartDescription);
   const refreshInventory = useAction(api.cjActions.refreshInventory);
   const generatePageStructure = useAction(api.ai.generatePageStructure);
   const generateBlogExcerpts = useAction(api.ai.generateBlogExcerpts);

   const [email, setEmail] = useState('');
   const [password, setPassword] = useState('');
   const [error, setError] = useState('');
   const [isSigningIn, setIsSigningIn] = useState(false);
   const [authFlow] = useState<'signIn' | 'signUp'>('signIn');

   // Navigation State
   const [activeTab, setActiveTabState] = useState<AdminTab>(() => {
      const saved = localStorage.getItem('admin-active-tab');
      const validTabs = ['dashboard', 'journal', 'pages', 'products', 'structure', 'newsletter', 'orders', 'cj-control-room', 'cj-risk-check', 'import', 'cj-settings'] as const;
      return saved && (validTabs as readonly string[]).includes(saved) ? saved as typeof validTabs[number] : 'dashboard';
   });
   const [cjNavContext, setCjNavContext] = useState<{ orderId?: string; productId?: string }>({});
   const setActiveTab = (tab: AdminTab, options?: { preserveCjContext?: boolean }) => {
      if (!options?.preserveCjContext) {
         setCjNavContext({});
      }
      setActiveTabState(tab);
      localStorage.setItem('admin-active-tab', tab);
   };
   const navigateCjAdmin = (request: CjAdminNavRequest) => {
      const target = typeof request === 'string' ? { tab: request } : request;
      setCjNavContext({ orderId: target.orderId, productId: target.productId });
      setActiveTab(target.tab, { preserveCjContext: true });
   };
   const [newsletterSubTab, setNewsletterSubTab] = useState<'overview' | 'campaigns' | 'subscribers'>('overview');
   const [sidebarOpen, setSidebarOpen] = useState(false);

   const [activePageEditor, setActivePageEditor] = useState<'home' | 'story' | string | null>(null);
   const [filterCollection, setFilterCollection] = useState<CollectionType | 'all'>('all');
   const [filterCategory, setFilterCategory] = useState<string | null>(null);
   const [inventorySearch, setInventorySearch] = useState('');

   // Expanded Menus State in Sidebar
   const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({});

   // Blog Editor State
   const [isEditingPost, setIsEditingPost] = useState(false);
   const [editingPost, setEditingPost] = useState<Partial<BlogPost> | null>(null);
   const [excerptGenerating, setExcerptGenerating] = useState(false);
   const [excerptOptions, setExcerptOptions] = useState<{ style: string; text: string }[]>([]);

   // Product Editor State
   const [isEditingProduct, setIsEditingProduct] = useState(false);
   const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
   const [isBatchRegenerating, setIsBatchRegenerating] = useState(false);
   const [refreshingInventoryProductId, setRefreshingInventoryProductId] = useState<string | null>(null);
   const [batchDescriptionPreviews, setBatchDescriptionPreviews] = useState<Array<{
      product: Product;
      description: string;
      generatedDescription: string;
      auditId: string;
      fallbackUsed: boolean;
      warnings: string[];
      sourceQuality?: number;
   }>>([]);


   // Structure/Collection Editor State
   const [editingCollection, setEditingCollection] = useState<Partial<CollectionConfig> | null>(null);


   // Newsletter Editor State
   const [editingCampaign, setEditingCampaign] = useState<Partial<EmailCampaign> | null>(null);


   // New Page Generation State
   const [showPageGenerator, setShowPageGenerator] = useState(false);
   const [generatorPrompt, setGeneratorPrompt] = useState({ title: '', description: '' });
   const [isGenerating, setIsGenerating] = useState(false);

   // Section Picker State
   const [showSectionPicker, setShowSectionPicker] = useState(false);

   // Login Handler
   const handleLogin = async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setIsSigningIn(true);
      try {
         await signIn(email, password, authFlow);
         // Auth state will update automatically via useConvexAuth
      } catch (err: unknown) {
         setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
      } finally {
         setIsSigningIn(false);
      }
   };

   const handleReturnToSite = () => {
      window.location.hash = '';
   };

   const toggleCollectionExpand = (id: string) => {
      setExpandedCollections(prev => ({ ...prev, [id]: !prev[id] }));
   };

   // --- HELPER: ADD SECTION ---
   const handleAddSection = (type: PageSection['type']) => {
      const newSection: PageSection = {
         id: Date.now().toString(),
         type,
         heading: type === 'product-feature' ? undefined : 'New Section',
         content: type === 'text' || type === 'image-text' ? 'Add your content here...' : undefined,
         image: (type === 'hero' || type === 'image-text' || type === 'full-image') ? 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800' : undefined,
         items: type === 'grid' ? [
            { title: 'Item 1', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', link: '#' },
            { title: 'Item 2', image: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=800', link: '#' },
         ] : undefined,
         productId: type === 'product-feature' ? products[0]?.id : undefined
      };

      if (activePageEditor === 'home') {
         updateSiteContent('home', { sections: [...(siteContent.home.sections || []), newSection] });
      } else if (activePageEditor === 'story') {
         updateSiteContent('story', { sections: [...(siteContent.story.sections || []), newSection] });
      } else if (activePageEditor && activePageEditor !== 'story') {
         const page = siteContent.customPages.find(p => p.id === activePageEditor);
         if (page) {
            updateCustomPage(page.id, { sections: [...page.sections, newSection] });
         }
      }
      setShowSectionPicker(false);
   };

   // --- NEWSLETTER HANDLERS ---
   const handleCreateCampaign = () => {
      setEditingCampaign({
         subject: '',
         previewText: '',
         content: '<p>Dear Subscriber,</p><p>...</p>',
         type: 'newsletter',
         status: 'draft'
      });
   };



   // --- BLOG HANDLERS ---
   const handleCreateNewPost = () => {
      setEditingPost({
         title: '',
         category: 'Lifestyle',
         excerpt: '',
         content: '',
         image: 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?q=80&w=2000&auto=format&fit=crop',
         status: 'draft'
      });
      setIsEditingPost(true);
   };

   const handleEditPost = (post: BlogPost) => {
      setEditingPost(post);
      setIsEditingPost(true);
   };

   const handleSavePost = () => {
      if (!editingPost?.title || !editingPost?.content) return;
      if (editingPost.id) {
         updatePost(editingPost.id, editingPost);
      } else {
         addPost(editingPost as Omit<BlogPost, 'id' | 'date'>);
      }
      setIsEditingPost(false);
      setEditingPost(null);
   };

   const handleDeletePost = (id: string) => {
      if (confirm('Are you sure you want to delete this story? This cannot be undone.')) {
         deletePost(id);
      }
   };

   // --- PRODUCT HANDLERS ---
   const handleCreateProduct = () => {
      // Default to first collection if any
      const defaultCollection = siteContent.collections.length > 0 ? siteContent.collections[0].id : 'furniture';

      setEditingProduct({
         name: '',
         price: 0,
         description: '',
         images: ['https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800'],
         // Auto-select collection based on current view
         collection: filterCollection === 'all' ? defaultCollection : filterCollection,
         // Auto-select category if we are in a specific filter
         category: filterCategory || '',
         isNew: false,
         inStock: true,
         storefrontStatus: 'hidden'
      });
      setIsEditingProduct(true);
   };

   const handleEditProduct = (prod: Product) => {
      setEditingProduct(prod);
      setIsEditingProduct(true);
   };

   const handleDeleteProduct = (id: string) => {
      if (confirm('Delete this product?')) deleteProduct(id);
   };

   const handleSetProductStorefrontStatus = async (product: Product, storefrontStatus: Product['storefrontStatus']) => {
      const updates: Partial<Product> = {
         storefrontStatus,
         launchAddedAt: storefrontStatus === 'next_launch' ? new Date().toISOString() : product.launchAddedAt,
      };
      if (storefrontStatus === 'published' && !product.publishedAt) {
         updates.publishedAt = new Date().toISOString();
      }
      await updateProduct(product.id, updates);
   };

   const handleRefreshProductInventory = async (product: Product) => {
      setRefreshingInventoryProductId(product.id);
      try {
         const result = await refreshInventory({ productId: product.id as Id<'products'> });
         const summary = result.products[0];
         alert(summary
            ? `${product.name} stock checked: ${summary.status}${summary.totalInventoryNum !== undefined ? ` (${summary.totalInventoryNum} available)` : ''}.`
            : `${product.name} stock check finished.`
         );
      } catch (err) {
         console.error('Inventory refresh failed:', err);
         alert('Inventory refresh failed. Please try again in a minute.');
      } finally {
         setRefreshingInventoryProductId(null);
      }
   };

   const handleLaunchNextProducts = async () => {
      if (!confirm('Publish every item marked Next Launch and refresh the New Arrivals timing?')) return;
      try {
         const result = await launchNextProducts({});
         alert(`Launched ${result.launched} product${result.launched === 1 ? '' : 's'} to the storefront.`);
      } catch (err) {
         console.error('Launch failed:', err);
         alert('Launch failed. Please try again or check the console for details.');
      }
   };

   const buildSnapshotFromProduct = (product: Product) => buildSourceProductSnapshot({
      sourceUrl: product.sourceUrl,
      name: product.name,
      description: product.description,
      rawDescription: product.rawSourceDescription || product.description,
      htmlDescription: product.rawHtmlDescription || '',
      price: product.price,
      currency: product.sourceCurrency || 'USD',
      images: product.images || [],
      descriptionImages: product.descriptionImages || [],
      variants: product.variants || [],
      category: product.category,
      subcategory: product.subcategory,
      collection: product.collection,
      sourceMetadata: {
         productId: product.id,
         descriptionSource: product.descriptionSource,
         sourcePriceCny: product.sourcePriceCny,
      },
   });

   const handleBatchRegenerateDescriptions = async () => {
      const candidates = filteredProducts.filter(product => !product.smartDescription?.adminEdited);
      if (candidates.length === 0) {
         alert('No eligible products found. Admin-edited descriptions are protected.');
         return;
      }

      setIsBatchRegenerating(true);
      setBatchDescriptionPreviews([]);
      try {
         const previews = [];
         for (const product of candidates) {
            const result = await generateSmartDescription({
               request: {
                  productId: product.id,
                  sourceSnapshot: buildSnapshotFromProduct(product),
                  adminContext: {
                     selectedCategory: product.category,
                     selectedSubcategory: product.subcategory,
                     selectedCollection: product.collection,
                  },
                  generationMode: 'batch_regenerate',
                  options: {
                     allowImageAnalysis: true,
                     allowSeoKeywords: true,
                     forceFreshVariation: true,
                  },
               },
            } as any) as SmartDescriptionActionResult;

            if (result.ok && result.description && result.auditId) {
               previews.push({
                  product,
                  description: result.description,
                  generatedDescription: result.description,
                  auditId: result.auditId,
                  fallbackUsed: Boolean(result.fallbackUsed),
                  warnings: result.warnings || [],
                  sourceQuality: result.facts?.sourceQuality?.score,
               });
            }
         }
         setBatchDescriptionPreviews(previews);
      } catch (err) {
         console.error('Batch smart description generation failed:', err);
         alert('Batch smart description generation failed. Try again with fewer products.');
      } finally {
         setIsBatchRegenerating(false);
      }
   };

   const approveBatchDescription = async (preview: typeof batchDescriptionPreviews[number]) => {
      const adminEdited = preview.description.trim() !== preview.generatedDescription.trim();
      const updatedProduct: Partial<Product> = {
         description: preview.description,
         smartDescription: {
            description: preview.description,
            auditId: preview.auditId as any,
            generatedAt: Date.now(),
            model: 'server-configured',
            promptVersion: 'smart-description-v2.0.0',
            sourceSnapshotHash: 'pending-link',
            adminEdited,
            status: adminEdited ? 'edited' : preview.fallbackUsed ? 'fallback' : 'approved',
         },
         descriptionSource: adminEdited ? 'ai_generated_admin_edited' : 'ai_generated',
      };
      await updateProduct(preview.product.id, updatedProduct);
      try {
         await linkDescriptionAuditToProduct({
            auditId: preview.auditId as any,
            productId: preview.product.id as any,
         });
      } catch (err) {
         console.warn('Failed to link smart description audit:', err);
      }
      setBatchDescriptionPreviews(prev => prev.filter(item => item.auditId !== preview.auditId));
   };

   // --- STRUCTURE HANDLERS ---
   const handleCreateCollection = () => {
      setEditingCollection({
         id: '',
         title: '',
         subtitle: 'Curated Collection',
         heroImage: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=2000',
         subcategories: []
      });
   };

   const handleSaveCollection = () => {
      if (!editingCollection?.id || !editingCollection?.title) {
         alert('ID and Title are required');
         return;
      }

      const exists = siteContent.collections.find(c => c.id === editingCollection.id);
      if (exists) {
         updateCollection(editingCollection.id, editingCollection);
      } else {
         addCollection(editingCollection as CollectionConfig);
      }
      setEditingCollection(null);
   };

   const handleDeleteCollection = (id: string) => {
      if (confirm(`Delete collection "${id}"? Products in this collection will remain but be uncategorized.`)) {
         deleteCollection(id);
      }
   };

   // --- PAGE GENERATION HANDLERS ---
   const handleGeneratePage = async () => {
      if (!generatorPrompt.title || !generatorPrompt.description) return;

      setIsGenerating(true);
      try {
         const generatedContent = await generatePageStructure({
            prompt: generatorPrompt.description,
            title: generatorPrompt.title,
         });

         const newPage: CustomPage = {
            id: Date.now().toString(),
            slug: generatorPrompt.title.toLowerCase().replace(/\s+/g, '-'),
            title: generatedContent.title,
            sections: generatedContent.sections as unknown as PageSection[]
         };

         addCustomPage(newPage);
         setShowPageGenerator(false);
         setGeneratorPrompt({ title: '', description: '' });
         setActivePageEditor(newPage.id);
      } catch {
         alert("Failed to generate page. Please try again.");
      } finally {
         setIsGenerating(false);
      }
   };

   const handleDeleteCustomPage = (id: string) => {
      if (confirm('Are you sure you want to delete this entire page?')) {
         deleteCustomPage(id);
         setActivePageEditor(null);
      }
   };

   // Helper to get collection title
   const getCollectionTitle = (id: string) => {
      if (id === 'all') return 'All Inventory';
      return siteContent.collections.find(c => c.id === id)?.title || id;
   };

   // Filter products
   const nextLaunchCount = products.filter(product => product.storefrontStatus === 'next_launch').length;

   const filteredProducts = products.filter(p => {
      const matchCollection = filterCollection === 'all' ? true : p.collection === filterCollection;
      const matchCategory = filterCategory ? p.category === filterCategory : true;
      const term = inventorySearch.trim().toLowerCase();
      const searchable = [
         p.name,
         p.description,
         p.category,
         p.collection,
         p.sourceUrl,
         p.cjProductId,
         p.cjVariantId,
         p.cjSku,
         ...(p.variants || []).flatMap(variant => [variant.name, variant.cjVariantId, variant.cjSku]),
      ]
         .filter(Boolean)
         .join(' ')
         .toLowerCase();
      const matchSearch = term.length === 0 || searchable.includes(term);
      return matchCollection && matchCategory && matchSearch;
   });

   // --- LOGIN SCREEN ---
   if (!isAuthenticated) {
      if (isAuthLoading) {
         return (
            <div className="min-h-screen bg-transparent flex items-center justify-center">
               <Loader2 className="w-8 h-8 text-bronze animate-spin" />
            </div>
         );
      }
      return (
         <div className="min-h-screen bg-gradient-to-br from-cream/30 to-white/10 flex items-center justify-center px-6 relative overflow-hidden font-sans">
            {/* Hyper-glassmorphic Animated Background */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
               <div className="absolute -top-20 -left-20 w-[800px] h-[800px] bg-bronze/10 rounded-full mix-blend-multiply filter blur-[60px] md:blur-[100px] opacity-80 animate-blob motion-reduce:animate-none" />
               <div className="absolute top-40 right-0 w-[600px] h-[600px] bg-sand/20 rounded-full mix-blend-multiply filter blur-[60px] md:blur-[100px] opacity-80 animate-blob motion-reduce:animate-none animation-delay-2000" />
               <div className="absolute -bottom-40 left-40 w-[600px] h-[600px] bg-earth/5 rounded-full mix-blend-multiply filter blur-[60px] md:blur-[100px] opacity-80 animate-blob motion-reduce:animate-none animation-delay-4000" />
               <div className="absolute inset-0 backdrop-blur-[30px] md:backdrop-blur-[60px] bg-white/10" />
            </div>

            <FadeIn className="w-full max-w-lg relative z-20">
               <div className="bg-white/20 backdrop-blur-3xl p-12 shadow-[0_40px_100px_rgba(0,0,0,0.1)] rounded-[2.5rem] border border-white/50 relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent opacity-50 pointer-events-none" />

                  {/* Decorative Header */}
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-bronze/30 to-transparent" />

                  <div className="mb-10">
                     <span className="text-bronze text-[10px] uppercase tracking-[0.4em] mb-4 block font-medium">Internal Portal</span>
                     <h1 className="font-serif text-5xl text-earth italic">The Atelier</h1>
                     <div className="w-12 h-0.5 bg-earth/10 mx-auto mt-6" />
                  </div>

                  <form onSubmit={handleLogin} className="space-y-6">
                     <div className="relative group">
                        <Mail className="absolute left-0 top-3 w-5 h-5 text-earth/30 group-focus-within:text-bronze transition-colors" />
                        <input
                           type="email"
                           value={email}
                           onChange={(e) => setEmail(e.target.value)}
                           placeholder="Access ID (Email)"
                           className="w-full bg-transparent border-b border-earth/10 py-3 pl-8 text-earth placeholder:text-earth/30 focus:outline-none focus:border-bronze transition-colors text-sm tracking-wide"
                           required
                        />
                     </div>
                     <div className="relative group">
                        <Lock className="absolute left-0 top-3 w-5 h-5 text-earth/30 group-focus-within:text-bronze transition-colors" />
                        <input
                           type="password"
                           value={password}
                           onChange={(e) => setPassword(e.target.value)}
                           placeholder="Passkey"
                           className="w-full bg-transparent border-b border-earth/10 py-3 pl-8 text-earth placeholder:text-earth/30 focus:outline-none focus:border-bronze transition-colors text-sm tracking-wide"
                           required
                        />
                     </div>

                     {error && (
                        <div className="flex items-center justify-center gap-2 p-3 bg-red-50/50 rounded-lg border border-red-100/50">
                           <span className="text-red-800 text-[10px] tracking-widest uppercase">{error}</span>
                        </div>
                     )}

                     <button
                        type="submit"
                        disabled={isSigningIn}
                        className="w-full bg-gradient-to-r from-[#3a2a1a] to-[#2d1f12] text-cream border border-bronze/30 py-4 rounded-xl text-[10px] uppercase tracking-[0.25em] hover:shadow-[0_8px_25px_rgba(139,90,43,0.35)] hover:-translate-y-0.5 transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-8 relative overflow-hidden group shadow-[0_4px_15px_rgba(0,0,0,0.2)]"
                     >
                        <span className="absolute inset-0 bg-gradient-to-r from-bronze/0 via-bronze/20 to-bronze/0 transform -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></span>
                        <span className="relative z-10">{isSigningIn ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Authenticate'}</span>
                     </button>
                  </form>

                  <div className="mt-8 pt-6 border-t border-earth/5">
                     <button onClick={handleReturnToSite} className="text-[9px] uppercase tracking-[0.2em] text-earth/30 hover:text-bronze transition-colors flex items-center justify-center gap-2 mx-auto">
                        <ChevronLeft className="w-3 h-3" /> Return to Storefront
                     </button>
                  </div>
               </div>
            </FadeIn>
         </div>
      );
   }

   // Helper to switch tabs and close mobile sidebar
   const switchTab = (tab: AdminTab, extra?: () => void) => {
      setActiveTab(tab);
      setSidebarOpen(false);
      extra?.();
   };

   // --- MAIN ADMIN INTERFACE ---
   return (
      <div className="min-h-screen bg-gradient-to-br from-[#120D09] via-[#1A130E] to-[#0A0705] relative overflow-hidden flex font-sans text-cream selection:bg-bronze/30">
         {/* Hyper-glassmorphic Animated Background (Dark Mode) */}
         <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none -z-10">
             <div className="absolute -top-20 -left-20 w-[1000px] h-[1000px] bg-bronze/10 rounded-full mix-blend-screen filter blur-[72px] md:blur-[120px] opacity-40 animate-blob motion-reduce:animate-none" />
             <div className="absolute top-20 right-0 w-[800px] h-[800px] bg-[#3a2a1a]/20 rounded-full mix-blend-screen filter blur-[72px] md:blur-[120px] opacity-30 animate-blob motion-reduce:animate-none animation-delay-2000" />
             <div className="absolute -bottom-40 left-40 w-[800px] h-[800px] bg-[#2d1f12]/20 rounded-full mix-blend-screen filter blur-[72px] md:blur-[120px] opacity-40 animate-blob motion-reduce:animate-none animation-delay-4000" />
             <div className="absolute inset-0 backdrop-blur-[40px] md:backdrop-blur-[100px] bg-black/10" />
         </div>

         {/* Mobile Top Bar */}
         <div className="fixed top-0 left-0 right-0 h-14 z-[60] md:hidden bg-[#1A130E]/95 backdrop-blur-xl flex items-center justify-between px-4 border-b border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
            <button onClick={() => setSidebarOpen(true)} aria-label="Open navigation" aria-expanded={sidebarOpen} className="p-2 text-cream/80 hover:text-cream transition-colors">
               <Menu className="w-6 h-6" />
            </button>
            <h2 className="font-serif text-xl text-cream italic drop-shadow-md">The Atelier</h2>
            <div className="w-10" /> {/* spacer for centering */}
         </div>

         {/* Mobile Sidebar Backdrop */}
         {sidebarOpen && (
            <div
               className="fixed inset-0 z-[190] bg-black/50 backdrop-blur-sm md:hidden"
               onClick={() => setSidebarOpen(false)}
            />
         )}

         {/* Glassmorphic Sidebar */}
         <aside className={`w-72 fixed h-[96vh] top-[2vh] left-4 z-[200] flex flex-col rounded-[2rem] overflow-hidden border border-bronze/30 shadow-[0_40px_100px_rgba(139,90,43,0.35),inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-3xl bg-gradient-to-b from-[#3a2a1a]/90 via-[#2d1f12]/85 to-[#1a130a]/90 text-cream transition-all duration-500 ${sidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)]'} md:translate-x-0`}>
            {/* Glossy sheen overlay */}
            <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-white/10 via-transparent to-bronze/5 pointer-events-none" />
            {/* Inner Glass Highlight */}
            <div className="absolute inset-0 rounded-[2rem] border border-white/10 pointer-events-none" />
            {/* Warm ambient glow */}
            <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-bronze/10 to-transparent pointer-events-none" />
            {/* Header */}
            <div className="p-8 border-b border-bronze/15 bg-gradient-to-r from-white/[0.08] to-bronze/5 relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-32 h-32 bg-bronze/30 rounded-full blur-3xl -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700 pointer-events-none" />
               <div className="absolute bottom-0 left-0 w-24 h-24 bg-amber-600/15 rounded-full blur-2xl -ml-12 -mb-12 pointer-events-none" />
               <h2 className="font-serif text-3xl italic tracking-wide relative z-10 text-cream drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">The Atelier</h2>
               <div className="flex items-center gap-2 mt-2 opacity-80">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_10px_rgba(74,222,128,0.5)]" />
                  <p className="text-[9px] uppercase tracking-[0.25em] relative z-10 text-cream/70">Admin Console</p>
               </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto custom-scrollbar">
               {/* Dashboard */}
               <button
                  onClick={() => switchTab('dashboard', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'dashboard' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <Home className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'dashboard' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">Dashboard</span>
                  {activeTab === 'dashboard' && <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-100" />}
               </button>

               {/* Newsletter */}
               <button
                  onClick={() => switchTab('newsletter', () => { setNewsletterSubTab('overview'); setActivePageEditor(null); })}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'newsletter' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <Mail className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'newsletter' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">Newsletter</span>
               </button>

               {/* Orders */}
               <button
                  onClick={() => switchTab('orders', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'orders' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <Package className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'orders' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">Orders</span>
               </button>

               {/* CJ Control Room */}
               <button
                  onClick={() => switchTab('cj-control-room', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'cj-control-room' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <BarChart2 className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'cj-control-room' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">CJ Control</span>
               </button>

               {/* CJ Risk Check */}
               <button
                  onClick={() => switchTab('cj-risk-check', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'cj-risk-check' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <Lock className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'cj-risk-check' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">Risk Check</span>
               </button>

               {/* Separator */}
               <div className="px-4 pt-6 pb-2">
                  <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-4" />
                  <span className="text-[9px] uppercase tracking-[0.3em] text-bronze/70 font-bold block mb-2 shimmer-text">Store Management</span>
               </div>

               {/* Structure */}
               <button
                  onClick={() => switchTab('structure', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'structure' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <Layers className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'structure' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">Structure</span>
               </button>

               {/* Import */}
               <button
                  onClick={() => switchTab('import', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'import' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <Upload className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'import' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">Import</span>
               </button>

               {/* CJ Settings */}
               <button
                  onClick={() => switchTab('cj-settings', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'cj-settings' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <Settings className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'cj-settings' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">CJ Settings</span>
               </button>


               {/* Collections Loop */}
               <div className="px-4 pt-6 pb-2">
                  <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-4" />
                  <span className="text-[9px] uppercase tracking-[0.3em] text-bronze/70 font-bold block mb-2 shimmer-text">Collections</span>
               </div>

               {siteContent.collections.map(collection => (
                  <div className="mb-1" key={collection.id}>
                     <button
                        onClick={() => toggleCollectionExpand(collection.id)}
                        className={`w-full text-left px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] flex items-center justify-between rounded-lg transition-all ${activeTab === 'products' && filterCollection === collection.id ? 'text-white' : 'text-white/50 hover:text-white'}`}
                     >
                        <div className="flex items-center gap-3">
                           <span className={`w-1 h-1 rounded-full ${activeTab === 'products' && filterCollection === collection.id ? 'bg-bronze shadow-[0_0_8px_rgba(168,140,119,0.8)]' : 'bg-white/20'}`} />
                           {collection.title}
                        </div>
                        <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${expandedCollections[collection.id] ? 'rotate-180 text-white' : 'text-white/20'}`} />
                     </button>

                     <div className={`overflow-hidden transition-all duration-500 ease-in-out ${expandedCollections[collection.id] ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                        <div className="pl-4 space-y-0.5 mt-1 ml-4 border-l border-white/5">
                           <button
                              onClick={() => switchTab('products', () => { setFilterCollection(collection.id); setFilterCategory(null); setIsEditingProduct(false); setActivePageEditor(null); })}
                              className={`w-full text-left px-3 py-2 text-[9px] uppercase tracking-[0.15em] rounded-r-lg transition-all hover:pl-5 duration-300 ${activeTab === 'products' && filterCollection === collection.id && !filterCategory ? 'text-bronze font-bold bg-white/5' : 'text-white/40 hover:text-white'}`}
                           >
                              View All
                           </button>
                           {collection.subcategories.map(cat => (
                              <button
                                 key={cat.id}
                                 onClick={() => switchTab('products', () => { setFilterCollection(collection.id); setFilterCategory(cat.title); setIsEditingProduct(false); setActivePageEditor(null); })}
                                 className={`w-full text-left px-3 py-2 text-[9px] uppercase tracking-[0.15em] rounded-r-lg transition-all hover:pl-5 duration-300 ${activeTab === 'products' && filterCollection === collection.id && filterCategory === cat.title ? 'text-white font-bold bg-white/5' : 'text-white/40 hover:text-white'}`}
                              >
                                 {cat.title.replace(collection.title + ' ', '')}
                              </button>
                           ))}
                        </div>
                     </div>
                  </div>
               ))}

               {/* Content Section */}
               <div className="px-4 pt-6 pb-2">
                  <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-4" />
                  <span className="text-[9px] uppercase tracking-[0.3em] text-bronze/70 font-bold block mb-2 shimmer-text">Content</span>
               </div>

               <button
                  onClick={() => switchTab('journal', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'journal' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <BookOpen className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'journal' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">Journal</span>
               </button>

               <button
                  onClick={() => switchTab('pages', () => setActivePageEditor(null))}
                  className={`relative group w-full text-left px-5 py-3.5 text-xs uppercase tracking-[0.15em] flex items-center gap-4 rounded-xl transition-all mb-2 overflow-hidden ${activeTab === 'pages' ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
               >
                  <Layout className={`w-4 h-4 transition-transform duration-500 ${activeTab === 'pages' ? 'scale-110 text-bronze' : 'group-hover:scale-110'}`} />
                  <span className="relative z-10 font-medium">Pages</span>
               </button>

            </nav>

            {/* User Profile / Exit */}
            <div className="p-4 bg-black/20 backdrop-blur-md border-t border-white/5 mt-auto">
               <button onClick={() => { logout(); handleReturnToSite(); }} className="w-full flex items-center gap-3 px-4 py-3 text-xs uppercase tracking-[0.2em] text-red-300/60 hover:text-red-300 hover:bg-red-900/10 rounded-lg transition-all group">
                  <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                  <span>Exit Studio</span>
               </button>
            </div>
         </aside>

         {/* Main Content Area */}
         <main className="ml-0 md:ml-[19.5rem] flex-1 p-4 md:px-6 md:py-6 pt-24 md:pt-6 min-h-screen overflow-y-auto custom-scrollbar relative">

            {/* DASHBOARD VIEW */}
            {activeTab === 'dashboard' && (
               <FadeIn>
                  {/* Premium Header */}
                  <div className="mb-10 md:mb-16 relative mt-2 md:mt-0">
                     <div className="absolute -left-4 md:-left-10 -top-4 md:-top-10 w-32 md:w-40 h-32 md:h-40 bg-bronze/20 rounded-full blur-3xl mix-blend-screen opacity-50 animate-blob motion-reduce:animate-none pointer-events-none" />
                     <span className="text-bronze text-[10px] uppercase tracking-[0.4em] mb-3 md:mb-4 block font-medium relative z-10 pl-1 drop-shadow-sm">Executive Overview</span>
                     <h1 className="font-serif text-4xl md:text-5xl text-cream relative z-10 tracking-tight leading-tight md:leading-tight drop-shadow-md">
                        Welcome Back,<br className="md:hidden" /> <span className="italic text-bronze/90 drop-shadow-[0_0_15px_rgba(139,90,43,0.3)]">Monica.</span>
                     </h1>
                  </div>


                   {/* Glass Metric Cards */}
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8 mb-10 md:mb-16">
                      {[
                         { title: 'Active Products', count: products.length, Icon: ShoppingBag, onClick: () => { setActiveTab('products'); setFilterCollection('all'); setFilterCategory(null); } },
                         { title: 'Collections', count: siteContent.collections.length, Icon: Layers, onClick: () => setActiveTab('structure') },
                         { title: 'Content Pages', count: 2 + siteContent.customPages.length, Icon: Layout, onClick: () => setActiveTab('pages') },
                      ].map(({ title, count, Icon, onClick }) => (
                         <button
                            key={title}
                            onClick={onClick}
                            aria-label={`${count} ${title}`}
                            className="group relative bg-white/5 backdrop-blur-3xl border border-white/10 p-6 md:p-8 rounded-[2.5rem] shadow-[0_15px_30px_rgba(0,0,0,0.3)] hover:shadow-[0_20px_50px_rgba(0,0,0,0.5)] hover:-translate-y-2 hover:bg-white/10 hover:border-bronze/30 transition-all duration-500 cursor-pointer overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#120D09]"
                         >
                            {/* Glass Highlight Line */}
                            <div className="absolute inset-0 rounded-[2.5rem] border-[2px] border-white/5 pointer-events-none transition-colors group-hover:border-white/10 mix-blend-overlay" />
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity duration-500 scale-125 group-hover:scale-150 transform origin-top-right text-white">
                               <Icon className="w-24 h-24 rotate-12" />
                            </div>

                            <div className="relative z-10">
                               <div className="w-14 h-14 rounded-2xl bg-black/40 backdrop-blur-md shadow-[inset_0_1px_10px_rgba(255,255,255,0.1)] flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-black/60 transition-all duration-500 border border-white/10">
                                  <Icon className="w-7 h-7 text-bronze drop-shadow-[0_0_8px_rgba(139,90,43,0.5)]" />
                               </div>
                               <h3 className="font-serif text-4xl text-cream mb-2 drop-shadow-sm">{count}</h3>
                               <p className="text-xs uppercase tracking-[0.2em] text-cream/60 font-medium">{title}</p>
                            </div>
                         </button>
                      ))}</div>

                  {/* Quick Actions Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                     <button onClick={handleCreateProduct} className="group relative overflow-hidden bg-white/5 backdrop-blur-2xl text-cream border border-white/10 rounded-[2rem] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.2)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:bg-white/10 hover:border-bronze/40 transition-all duration-500 hover:-translate-y-1">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        <div className="relative z-10 flex flex-col items-center text-center gap-4">
                           <div className="p-4 bg-black/30 rounded-full group-hover:bg-black/50 group-hover:scale-110 transition-all duration-500 border border-white/5 shadow-[inset_0_1px_10px_rgba(255,255,255,0.05)]"><Plus className="w-6 h-6 text-cream" /></div>
                           <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-cream/90 group-hover:text-cream transition-colors">Add Product</span>
                        </div>
                     </button>

                     <button onClick={handleCreateNewPost} className="group relative overflow-hidden bg-white/5 backdrop-blur-2xl text-cream border border-white/10 rounded-[2rem] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.2)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:bg-white/10 hover:border-bronze/40 transition-all duration-500 hover:-translate-y-1">
                        <div className="relative z-10 flex flex-col items-center text-center gap-4">
                           <div className="p-4 bg-black/30 rounded-full group-hover:bg-black/50 group-hover:scale-110 transition-all duration-500 border border-white/5 shadow-[inset_0_1px_10px_rgba(255,255,255,0.05)]"><PenTool className="w-6 h-6 text-cream" /></div>
                           <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-cream/90 group-hover:text-cream transition-colors">Write Journal</span>
                        </div>
                     </button>

                     <button onClick={() => { setActiveTab('newsletter'); setNewsletterSubTab('campaigns'); handleCreateCampaign(); }} className="group relative overflow-hidden bg-white/5 backdrop-blur-2xl text-cream border border-white/10 rounded-[2rem] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.2)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:bg-white/10 hover:border-bronze/40 transition-all duration-500 hover:-translate-y-1">
                        <div className="relative z-10 flex flex-col items-center text-center gap-4">
                           <div className="p-4 bg-black/30 rounded-full group-hover:bg-black/50 group-hover:scale-110 transition-all duration-500 border border-white/5 shadow-[inset_0_1px_10px_rgba(255,255,255,0.05)]"><Send className="w-6 h-6 text-cream" /></div>
                           <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-cream/90 group-hover:text-cream transition-colors">Send Email</span>
                        </div>
                     </button>

                     <button onClick={() => { setActiveTab('cj-settings'); }} className="group relative overflow-hidden bg-white/5 backdrop-blur-2xl text-cream border border-white/10 rounded-[2rem] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.2)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:bg-white/10 hover:border-bronze/40 transition-all duration-500 hover:-translate-y-1">
                        <div className="relative z-10 flex flex-col items-center text-center gap-4">
                           <div className="p-4 bg-black/30 rounded-full group-hover:bg-black/50 group-hover:scale-110 transition-all duration-500 border border-white/5 shadow-[inset_0_1px_10px_rgba(255,255,255,0.05)]"><Settings className="w-6 h-6 text-cream" /></div>
                           <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-cream/90 group-hover:text-cream transition-colors">Integration</span>
                        </div>
                     </button>
                  </div>

               </FadeIn>
            )}

            {/* ORDERS TAB */}
            {activeTab === 'orders' && (
               <FadeIn>
                  <AdminOrders />
               </FadeIn>
            )}

            {/* CJ CONTROL ROOM TAB */}
            {activeTab === 'cj-control-room' && (
               <FadeIn>
                  <CJControlRoom
                     onNavigateToTab={navigateCjAdmin}
                     targetOrderId={cjNavContext.orderId}
                     targetProductId={cjNavContext.productId}
                  />
               </FadeIn>
            )}

            {/* CJ RISK CHECK TAB */}
            {activeTab === 'cj-risk-check' && (
               <FadeIn>
                  <CJRiskCheck onNavigateToTab={navigateCjAdmin} />
               </FadeIn>
            )}

            {/* IMPORT TAB */}
            {activeTab === 'import' && (
               <FadeIn>
                  <ProductImport
                     collections={siteContent.collections}
                     onImportProducts={async (productsToImport) => {
                        // Import each product and submit for CJ sourcing
                        const results = await Promise.all(
                           productsToImport.map(async (product) => {
                              const productId = await addProduct(product);
                              if (productId && product.smartDescription?.auditId) {
                                 try {
                                    await linkDescriptionAuditToProduct({
                                       auditId: product.smartDescription.auditId as any,
                                       productId: productId as any,
                                    });
                                 } catch (err) {
                                    console.warn('Failed to link smart description audit:', err);
                                 }
                              }
                              // If product has source URL and was created successfully, submit for CJ sourcing
                              if (productId && product.sourceUrl && product.cjSourcingStatus === 'pending') {
                                 // CJ sourcing will be triggered by the cron job or manual check
                                 // The product is already marked as pending in the database
                                 return { id: productId, pending: true };
                              }
                              return { id: productId, pending: false };
                           })
                        );
                        const pendingCount = results.filter(r => r.pending).length;
                        const successMessage = pendingCount > 0
                           ? `Successfully imported ${productsToImport.length} products as hidden inventory. ${pendingCount} products were queued for CJ sourcing. Publish them or add them to Next Launch when ready.`
                           : `Successfully imported ${productsToImport.length} products as hidden inventory. Publish them or add them to Next Launch when ready.`;
                        alert(successMessage);
                     }}
                  />
               </FadeIn>
            )}

            {/* CJ SETTINGS TAB */}
            {activeTab === 'cj-settings' && (
               <FadeIn>
                  <CJSettings targetProductId={cjNavContext.productId} />
               </FadeIn>
            )}

            {/* NEWSLETTER TAB */}
            {activeTab === 'newsletter' && (
               <FadeIn>
                  <div className="mb-12 border-b border-white/10 pb-6 flex flex-col md:flex-row gap-4 md:gap-0 justify-between md:items-end">
                     <div>
                        <span className="text-bronze text-xs uppercase tracking-[0.4em] mb-2 block glow-text">Communications</span>
                        <h1 className="font-serif text-2xl md:text-4xl text-cream drop-shadow-md">The Mae Letter</h1>
                     </div>
                     <div className="flex flex-wrap gap-2 md:gap-4 bg-black/20 p-1.5 rounded-xl border border-white/5 backdrop-blur-md">
                        <button
                           onClick={() => setNewsletterSubTab('overview')}
                           className={`px-4 py-2 text-xs uppercase tracking-widest rounded-lg transition-colors ${newsletterSubTab === 'overview' ? 'bg-white/10 text-cream shadow-sm border border-white/10' : 'text-cream/40 hover:text-cream hover:bg-white/5'}`}
                        >
                           Overview
                        </button>
                        <button
                           onClick={() => setNewsletterSubTab('campaigns')}
                           className={`px-4 py-2 text-xs uppercase tracking-widest rounded-lg transition-colors ${newsletterSubTab === 'campaigns' ? 'bg-white/10 text-cream shadow-sm border border-white/10' : 'text-cream/40 hover:text-cream hover:bg-white/5'}`}
                        >
                           Campaigns
                        </button>
                        <button
                           onClick={() => setNewsletterSubTab('subscribers')}
                           className={`px-4 py-2 text-xs uppercase tracking-widest rounded-lg transition-colors ${newsletterSubTab === 'subscribers' ? 'bg-white/10 text-cream shadow-sm border border-white/10' : 'text-cream/40 hover:text-cream hover:bg-white/5'}`}
                        >
                           Subscribers
                        </button>
                     </div>
                  </div>

                  {/* NEWSLETTER: OVERVIEW */}
                  {newsletterSubTab === 'overview' && (
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div className="bg-white/5 backdrop-blur-3xl p-8 border border-white/10 rounded-3xl shadow-[0_15px_30px_rgba(0,0,0,0.3)] hover:-translate-y-1 transition-transform overflow-hidden relative group">
                           <div className="absolute top-0 right-0 w-32 h-32 bg-bronze/10 rounded-full blur-2xl -mr-10 -mt-10 group-hover:scale-150 transition-transform pointer-events-none" />
                           <Users className="w-8 h-8 text-bronze mb-6 drop-shadow-[0_0_8px_rgba(139,90,43,0.5)]" />
                           <h3 className="font-serif text-4xl text-cream mb-2 drop-shadow-sm">{stats.totalSubscribers}</h3>
                           <p className="text-xs uppercase tracking-widest text-cream/50 relative z-10">Total Subscribers</p>
                        </div>
                        <div className="bg-white/5 backdrop-blur-3xl p-8 border border-white/10 rounded-3xl shadow-[0_15px_30px_rgba(0,0,0,0.3)] hover:-translate-y-1 transition-transform overflow-hidden relative group">
                           <div className="absolute top-0 right-0 w-32 h-32 bg-bronze/10 rounded-full blur-2xl -mr-10 -mt-10 group-hover:scale-150 transition-transform pointer-events-none" />
                           <BarChart2 className="w-8 h-8 text-bronze mb-6 drop-shadow-[0_0_8px_rgba(139,90,43,0.5)]" />
                           <h3 className="font-serif text-4xl text-cream mb-2 drop-shadow-sm">{stats.avgOpenRate}%</h3>
                           <p className="text-xs uppercase tracking-widest text-cream/50 relative z-10">Avg. Open Rate</p>
                        </div>
                        <div className="bg-white/5 backdrop-blur-3xl p-8 border border-white/10 rounded-3xl shadow-[0_15px_30px_rgba(0,0,0,0.3)] hover:-translate-y-1 transition-transform overflow-hidden relative group">
                           <div className="absolute top-0 right-0 w-32 h-32 bg-bronze/10 rounded-full blur-2xl -mr-10 -mt-10 group-hover:scale-150 transition-transform pointer-events-none" />
                           <Send className="w-8 h-8 text-bronze mb-6 drop-shadow-[0_0_8px_rgba(139,90,43,0.5)]" />
                           <h3 className="font-serif text-4xl text-cream mb-2 drop-shadow-sm">{stats.totalEmailsSent}</h3>
                           <p className="text-xs uppercase tracking-widest text-cream/50 relative z-10">Emails Sent</p>
                        </div>
                     </div>
                  )}

                  {/* NEWSLETTER: SUBSCRIBERS */}
                  {newsletterSubTab === 'subscribers' && (
                     <div className="overflow-x-auto bg-white border border-earth/5">
                        <table className="w-full text-left text-sm text-earth/70 min-w-[500px]">
                           <thead className="bg-cream/50 text-xs uppercase tracking-widest text-earth/40">
                              <tr>
                                 <th className="px-6 py-4 font-normal">Email</th>
                                 <th className="px-6 py-4 font-normal">Joined</th>
                                 <th className="px-6 py-4 font-normal">Tags</th>
                                 <th className="px-6 py-4 font-normal">Status</th>
                              </tr>
                           </thead>
                           <tbody>
                              {subscribers.map(sub => (
                                 <tr key={sub.id} className="border-t border-earth/5 hover:bg-cream/20">
                                    <td className="px-6 py-4 font-serif text-lg text-earth">{sub.email}</td>
                                    <td className="px-6 py-4 font-mono text-xs">{sub.dateSubscribed}</td>
                                    <td className="px-6 py-4">
                                       <div className="flex gap-2">
                                          {sub.tags.map(tag => (
                                             <span key={tag} className="bg-earth/5 px-2 py-1 text-[9px] uppercase tracking-widest rounded-sm">
                                                {tag}
                                             </span>
                                          ))}
                                       </div>
                                    </td>
                                    <td className="px-6 py-4">
                                       <span className={`text-[9px] uppercase tracking-widest px-2 py-1 ${sub.status === 'active' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                                          {sub.status}
                                       </span>
                                    </td>
                                 </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                  )}

                  {/* NEWSLETTER: CAMPAIGNS */}
                  {newsletterSubTab === 'campaigns' && (
                     <div>
                        <div className="flex justify-end mb-8">
                           <button onClick={() => { handleCreateCampaign(); setEditingCampaign({ subject: '', content: '', status: 'draft', type: 'newsletter' }); }} className="bg-white/10 text-cream border border-white/20 px-6 py-3 text-[10px] uppercase tracking-[0.2em] hover:bg-white/20 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.3)] flex items-center gap-2 rounded-lg backdrop-blur-md hover:-translate-y-1">
                              <Plus className="w-3 h-3" /> New Campaign
                           </button>
                        </div>

                        <div className="space-y-4">
                           {campaigns.map(camp => (
                              <div key={camp.id} className="bg-white/5 backdrop-blur-xl p-4 md:p-6 border border-white/10 rounded-2xl flex flex-col md:flex-row justify-between md:items-center group gap-3 hover:bg-white/10 transition-colors shadow-lg">
                                 <div>
                                    <div className="flex items-center gap-3 mb-2">
                                       <span className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] ${camp.status === 'sent' ? 'bg-green-400 text-green-400' : 'bg-amber-400 text-amber-400'}`}></span>
                                       <h3 className="font-serif text-xl text-cream drop-shadow-sm">{camp.subject}</h3>
                                    </div>
                                    <div className="flex gap-6 text-xs text-cream/50">
                                       <span>{camp.status === 'sent' ? `Sent: ${camp.sentDate}` : 'Draft'}</span>
                                       {camp.status === 'sent' && (
                                          <>
                                             <span>Sent: {camp.stats.sent}</span>
                                             <span>Opened: {camp.stats.opened}</span>
                                             <span>Clicked: {camp.stats.clicked}</span>
                                          </>
                                       )}
                                    </div>
                                 </div>
                                 <div className="flex gap-2">
                                    {camp.status === 'draft' && (
                                       <button onClick={() => setEditingCampaign(camp)} aria-label={`Edit ${camp.subject}`} className="p-2 hover:bg-white/20 rounded-full text-cream transition-colors"><Edit3 className="w-4 h-4" /></button>
                                    )}
                                    <button onClick={() => deleteCampaign(camp.id)} aria-label={`Delete ${camp.subject}`} className="p-2 hover:bg-red-500/20 text-red-400 rounded-full transition-colors"><Trash2 className="w-4 h-4" /></button>
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                  )}

               </FadeIn>
            )}

            {/* STRUCTURE TAB */}
            {activeTab === 'structure' && (
               <FadeIn>
                  <div className="mb-12 border-b border-white/10 pb-6 flex flex-col md:flex-row gap-4 justify-between items-end">
                     <div>
                        <span className="text-bronze text-xs uppercase tracking-[0.4em] mb-2 block glow-text">Site Configuration</span>
                        <h1 className="font-serif text-2xl md:text-4xl text-cream drop-shadow-md">Structure & Navigation</h1>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

                     {/* COLLECTIONS MANAGER */}
                     <div className="bg-white/5 backdrop-blur-3xl p-8 border border-white/10 rounded-[2rem] shadow-[0_15px_30px_rgba(0,0,0,0.3)]">
                        <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                           <h3 className="font-serif text-2xl text-cream">Collections</h3>
                           <button onClick={handleCreateCollection} className="text-[10px] uppercase tracking-[0.2em] bg-white/10 text-cream px-4 py-2 hover:bg-white/20 transition-colors flex items-center gap-2 rounded-lg border border-white/20 shadow-sm">
                              <Plus className="w-3 h-3" /> New
                           </button>
                        </div>

                        <div className="space-y-4">
                           {siteContent.collections.map(col => (
                              <div key={col.id} className="bg-black/20 p-4 border border-white/5 rounded-xl flex justify-between items-center group hover:bg-white/5 transition-colors shadow-inner">
                                 <div>
                                    <h4 className="font-serif text-lg text-cream">{col.title}</h4>
                                    <p className="text-[10px] uppercase tracking-widest text-cream/40">{col.subcategories.length} Subcategories</p>
                                 </div>
                                 <div className="flex gap-2 opacity-50 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                    <button onClick={() => setEditingCollection(col)} aria-label={`Edit ${col.title}`} className="p-2 hover:bg-white/20 rounded-full text-cream"><Edit3 className="w-4 h-4" /></button>
                                    <button onClick={() => handleDeleteCollection(col.id)} aria-label={`Delete ${col.title}`} className="p-2 hover:bg-red-500/20 text-red-400 rounded-full"><Trash2 className="w-4 h-4" /></button>
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>

                     {/* NAVIGATION MANAGER (Simple view) */}
                     <div className="bg-white/5 backdrop-blur-3xl p-8 border border-white/10 rounded-[2rem] shadow-[0_15px_30px_rgba(0,0,0,0.3)] opacity-80 relative">
                        {/* Overlay for "Coming Soon" or simplified editor */}
                        <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                           <h3 className="font-serif text-2xl text-cream">Main Menu</h3>
                        </div>
                        <div className="space-y-2">
                           {siteContent.navLinks.map((link, i) => (
                              <div key={i} className="p-3 border-b border-white/5 font-serif text-lg text-cream/70 flex justify-between bg-black/10 rounded-lg">
                                 {link.label}
                                 <span className="text-xs font-sans text-cream/30">{link.href}</span>
                              </div>
                           ))}
                        </div>
                        <div className="mt-6 text-center text-xs text-cream/40 italic">
                           Menu structure is currently managed via code constants for stability.
                        </div>
                     </div>

                  </div>

                  {/* COLLECTION EDITOR MODAL */}
                  {editingCollection && (
                     <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8 rounded-2xl shadow-2xl relative animate-fade-in-up">
                           <button onClick={() => setEditingCollection(null)} className="absolute top-4 right-4 text-earth/30 hover:text-earth"><X className="w-5 h-5" /></button>
                           <h2 className="font-serif text-3xl text-earth mb-8">{editingCollection.id ? 'Edit Collection' : 'New Collection'}</h2>

                           <div className="space-y-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                                 <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">ID (URL Slug)</label>
                                    <input type="text" value={editingCollection.id} onChange={(e) => setEditingCollection({ ...editingCollection, id: e.target.value })} className="w-full bg-cream/30 p-3 border border-earth/10 font-mono text-sm" placeholder="e.g. furniture" />
                                 </div>
                                 <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Title</label>
                                    <input type="text" value={editingCollection.title} onChange={(e) => setEditingCollection({ ...editingCollection, title: e.target.value })} className="w-full bg-cream/30 p-3 border border-earth/10 font-serif text-lg" />
                                 </div>
                              </div>

                              <div>
                                 <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Subtitle</label>
                                 <input type="text" value={editingCollection.subtitle} onChange={(e) => setEditingCollection({ ...editingCollection, subtitle: e.target.value })} className="w-full bg-cream/30 p-3 border border-earth/10" />
                              </div>

                              <ImageUploader label="Hero Image" currentImage={editingCollection.heroImage} onImageChange={(val) => setEditingCollection({ ...editingCollection, heroImage: val })} aspectRatio="aspect-[21/9]" />

                              {/* Subcategories Editor */}
                              <div className="border-t border-earth/10 pt-6">
                                 <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-4">Subcategories</label>
                                 <div className="space-y-4">
                                    {editingCollection.subcategories?.map((sub, idx) => (
                                       <div key={idx} className="flex gap-4 items-start bg-cream/20 p-3 border border-earth/5">
                                          <div className="w-16 h-16 bg-white flex-shrink-0 relative">
                                             <img src={sub.image} className="w-full h-full object-cover" />
                                          </div>
                                          <div className="flex-1 space-y-2">
                                             <input value={sub.title} onChange={(e) => {
                                                const newSubs = [...(editingCollection.subcategories || [])];
                                                newSubs[idx] = { ...newSubs[idx], title: e.target.value, id: e.target.value.toLowerCase().replace(/\s+/g, '-') };
                                                setEditingCollection({ ...editingCollection, subcategories: newSubs });
                                             }} className="w-full bg-white p-1 border border-earth/10 text-xs font-bold" placeholder="Title" />
                                             <input value={sub.caption || ''} onChange={(e) => {
                                                const newSubs = [...(editingCollection.subcategories || [])];
                                                newSubs[idx] = { ...newSubs[idx], caption: e.target.value };
                                                setEditingCollection({ ...editingCollection, subcategories: newSubs });
                                             }} className="w-full bg-white p-1 border border-earth/10 text-xs" placeholder="Caption" />
                                          </div>
                                          <button onClick={() => {
                                             const newSubs = editingCollection.subcategories?.filter((_, i) => i !== idx);
                                             setEditingCollection({ ...editingCollection, subcategories: newSubs });
                                          }} className="text-red-800"><Trash2 className="w-4 h-4" /></button>
                                       </div>
                                    ))}
                                    <button onClick={() => setEditingCollection({
                                       ...editingCollection,
                                       subcategories: [...(editingCollection.subcategories || []), { id: 'new', title: 'New Category', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', caption: 'Description' }]
                                    })} className="text-[10px] uppercase text-bronze hover:underline">+ Add Subcategory</button>
                                 </div>
                              </div>

                              <button onClick={handleSaveCollection} className="w-full bg-earth text-cream py-4 text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-colors">Save Collection</button>
                           </div>
                        </div>
                     </div>
                  )}
               </FadeIn>
            )}

            {/* PRODUCTS TAB */}
            {activeTab === 'products' && (
               <FadeIn>
                  <div className="flex flex-col md:flex-row gap-3 md:gap-0 justify-between md:items-end mb-8 md:mb-12 border-b border-white/10 pb-4 md:pb-6">
                     <div>
                        <span className="text-bronze text-xs uppercase tracking-[0.4em] mb-2 block glow-text">{getCollectionTitle(filterCollection)}</span>
                        <h1 className="font-serif text-2xl md:text-4xl text-cream drop-shadow-md">{filterCategory || 'All Items'}</h1>
                     </div>
                     <div className="flex flex-wrap gap-2">
                        {nextLaunchCount > 0 && (
                           <button
                              onClick={handleLaunchNextProducts}
                              className="bg-emerald-500/10 text-emerald-100 border border-emerald-300/20 px-5 md:px-6 py-3 text-[10px] uppercase tracking-[0.2em] hover:bg-emerald-500/20 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.3)] flex items-center gap-2 rounded-lg w-fit backdrop-blur-md"
                           >
                              <Rocket className="w-3 h-3" />
                              Launch {nextLaunchCount}
                           </button>
                        )}
                        <button
                           onClick={handleBatchRegenerateDescriptions}
                           disabled={isBatchRegenerating || filteredProducts.length === 0}
                           className="bg-purple-500/10 text-purple-100 border border-purple-300/20 px-5 md:px-6 py-3 text-[10px] uppercase tracking-[0.2em] hover:bg-purple-500/20 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.3)] flex items-center gap-2 rounded-lg w-fit backdrop-blur-md disabled:opacity-50"
                        >
                           {isBatchRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <WandIcon className="w-3 h-3" />}
                           Smart Preview
                        </button>
                        <button onClick={handleCreateProduct} className="bg-white/10 text-cream border border-white/20 px-5 md:px-6 py-3 text-[10px] uppercase tracking-[0.2em] hover:bg-white/20 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.3)] flex items-center gap-2 rounded-lg w-fit backdrop-blur-md">
                           <Plus className="w-3 h-3" /> Add Product
                        </button>
                     </div>
                  </div>

                  <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-2xl shadow-[0_10px_25px_rgba(0,0,0,0.25)]">
                     <label htmlFor="inventory-search" className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-cream/50">
                        <Search className="w-3.5 h-3.5 text-bronze" />
                        Search Inventory
                     </label>
                     <div className="relative">
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cream/35" />
                        <input
                           id="inventory-search"
                           type="search"
                           value={inventorySearch}
                           onChange={(event) => setInventorySearch(event.target.value)}
                           placeholder="Search product, source URL, CJ ID, SKU, color, or size..."
                           className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-11 pr-4 text-sm text-cream placeholder:text-cream/30 focus:border-bronze focus:outline-none"
                        />
                     </div>
                  </div>

                  {batchDescriptionPreviews.length > 0 && (
                     <div className="mb-6 rounded-2xl border border-purple-300/20 bg-purple-500/10 p-4 backdrop-blur-xl">
                        <div className="flex items-center justify-between gap-4 mb-4">
                           <div>
                              <h2 className="text-sm uppercase tracking-[0.2em] text-purple-100">Smart Description Previews</h2>
                              <p className="text-xs text-cream/50 mt-1">Review each suggestion before saving it to inventory.</p>
                           </div>
                           <button onClick={() => setBatchDescriptionPreviews([])} className="text-cream/50 hover:text-cream">
                              <X className="w-4 h-4" />
                           </button>
                        </div>
                        <div className="space-y-3">
                           {batchDescriptionPreviews.map(preview => (
                              <div key={preview.auditId} className="rounded-xl border border-white/10 bg-black/20 p-4">
                                 <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                                    <div className="min-w-0">
                                       <p className="font-serif text-lg text-cream">{preview.product.name}</p>
                                       <p className="text-[10px] uppercase tracking-widest text-cream/40 mt-1">
                                          Source quality: {preview.sourceQuality ?? 'n/a'} / 100 {preview.fallbackUsed ? ' · fallback used' : ''}
                                       </p>
                                       {preview.product.sourceUrl && (
                                          <a
                                             href={preview.product.sourceUrl}
                                             target="_blank"
                                             rel="noreferrer"
                                             className="mt-2 inline-flex max-w-full items-center gap-1.5 text-[10px] text-bronze hover:text-amber-400"
                                          >
                                             <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                             <span className="truncate normal-case font-mono tracking-normal">{preview.product.sourceUrl}</span>
                                          </a>
                                       )}
                                    </div>
                                    <div className="flex gap-2">
                                       <button onClick={() => approveBatchDescription(preview)} className="px-3 py-2 rounded-lg bg-bronze text-white text-[10px] uppercase tracking-widest">
                                          Approve
                                       </button>
                                       <button onClick={() => setBatchDescriptionPreviews(prev => prev.filter(item => item.auditId !== preview.auditId))} className="px-3 py-2 rounded-lg bg-white/10 text-cream text-[10px] uppercase tracking-widest">
                                          Reject
                                       </button>
                                    </div>
                                 </div>
                                 <div className="mt-3 grid md:grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-lg bg-black/20 p-3 text-cream/50 whitespace-pre-wrap">{preview.product.description || 'No current description.'}</div>
                                    <textarea
                                       value={preview.description}
                                       onChange={(event) => setBatchDescriptionPreviews(prev => prev.map(item => item.auditId === preview.auditId ? { ...item, description: event.target.value } : item))}
                                       className="min-h-[180px] rounded-lg bg-white/5 p-3 text-cream whitespace-pre-wrap border border-white/10 focus:border-bronze focus:outline-none"
                                       aria-label={`Edit smart description for ${preview.product.name}`}
                                    />
                                 </div>
                                 {preview.warnings.length > 0 && (
                                    <div className="mt-3 text-xs text-amber-200/80">
                                       {preview.warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
                                    </div>
                                 )}
                              </div>
                           ))}
                        </div>
                     </div>
                  )}

                  <div className="grid grid-cols-1 gap-4">
                     {filteredProducts.length === 0 ? (
                        <div className="text-center py-20 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-2xl shadow-xl">
                           <p className="font-serif text-2xl text-cream/40">No products found in this collection.</p>
                           <button onClick={handleCreateProduct} className="mt-4 text-bronze hover:text-white transition-colors underline text-xs uppercase tracking-widest">Add your first item</button>
                        </div>
                     ) : (
                        filteredProducts.map(product => {
                           const storefrontStatus = product.storefrontStatus || 'published';
                           const statusClass = storefrontStatus === 'published'
                              ? 'bg-green-500/15 text-green-300 border-green-400/25'
                              : storefrontStatus === 'next_launch'
                                 ? 'bg-amber-500/15 text-amber-200 border-amber-300/25'
                                 : 'bg-white/10 text-cream/60 border-white/15';
                           const variants = product.variants || [];
                           const mappedVariants = variants.filter(variant => variant.cjVariantId).length;
                           const variantImageCount = variants.filter(variant => variant.image).length;
                           const imageCount = product.images?.filter(Boolean).length || 0;
                           const cjIdentifier = product.cjProductId || product.cjVariantId || 'Not linked yet';
                           const inventoryCheckedAt = product.cjInventoryLastCheckedAt
                              ? new Date(product.cjInventoryLastCheckedAt).toLocaleString()
                              : 'Not checked yet';
                           const inventoryStatus = product.cjInventoryStatus || 'unknown';
                           const inventoryStatusClass = inventoryStatus === 'in_stock'
                              ? 'text-green-300'
                              : inventoryStatus === 'low_stock' || inventoryStatus === 'partial'
                                 ? 'text-amber-200'
                                 : inventoryStatus === 'out_of_stock' || inventoryStatus === 'error'
                                    ? 'text-red-300'
                                    : 'text-cream/35';
                           const isRefreshingInventory = refreshingInventoryProductId === product.id;

                           return (
                              <div key={product.id} className="bg-white/5 backdrop-blur-xl p-4 md:p-5 border border-white/10 rounded-2xl flex flex-col md:flex-row gap-4 md:gap-6 md:items-center group hover:bg-white/10 hover:-translate-y-1 hover:shadow-[0_15px_30px_rgba(0,0,0,0.4)] transition-all overflow-hidden relative">
                                 {/* Inner Highlight Overlay */}
                                 <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-2xl group-hover:border-white/20 transition-colors" />

                                 <div className="w-full md:w-20 h-36 md:h-24 bg-black/40 flex-shrink-0 rounded-xl overflow-hidden border border-white/10 shadow-inner z-10">
                                    {product.images?.[0] ? (
                                       <SafeImage src={product.images[0]} alt={product.name} className="w-full h-full object-cover opacity-90 group-hover:scale-105 group-hover:opacity-100 transition-all duration-700" />
                                    ) : (
                                       <div className="flex h-full w-full items-center justify-center text-white/30"><Package className="w-5 h-5" aria-hidden="true" /></div>
                                    )}
                                 </div>

                                 <div className="flex-1 min-w-0 z-10 space-y-3">
                                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                                       <div className="min-w-0">
                                          <h4 className="font-serif text-lg text-cream drop-shadow-sm group-hover:text-white transition-colors">{product.name}</h4>
                                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-widest text-cream/50 mt-1">
                                             <span>{product.category || 'No category'}</span>
                                             <span className="text-bronze font-medium">${product.price}</span>
                                             <span className={product.inStock ? 'text-green-400 drop-shadow-[0_0_5px_rgba(74,222,128,0.5)]' : 'text-red-400'}>{product.inStock ? 'In Stock' : 'Out of Stock'}</span>
                                          </div>
                                       </div>
                                       <span className={`w-fit rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest ${statusClass}`}>
                                          {productStorefrontStatusLabel(product)}
                                       </span>
                                       {product.cjInventoryNeedsReview && (
                                          <span className="w-fit rounded-full border border-amber-300/30 bg-amber-500/15 px-3 py-1 text-[10px] uppercase tracking-widest text-amber-100">
                                             {product.cjInventoryReviewReason === 'restocked' ? 'Restock review' : 'Inventory review'}
                                          </span>
                                       )}
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-[11px] text-cream/55">
                                       <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                          <span className="block text-[9px] uppercase tracking-widest text-cream/30">Source URL</span>
                                          {product.sourceUrl ? (
                                             <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-bronze hover:text-amber-400" title={product.sourceUrl}>
                                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                                <span className="truncate font-mono">{product.sourceUrl}</span>
                                             </a>
                                          ) : (
                                             <button type="button" onClick={() => handleEditProduct(product)} className="text-cream/35 hover:text-bronze">Add source link</button>
                                          )}
                                       </div>
                                       <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                          <span className="block text-[9px] uppercase tracking-widest text-cream/30">CJ ID / SKU</span>
                                          <span className="font-mono text-cream/70">{cjIdentifier}</span>
                                          {product.cjSku && <span className="ml-2 font-mono text-cream/35">{product.cjSku}</span>}
                                       </div>
                                       <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                          <span className="block text-[9px] uppercase tracking-widest text-cream/30">Variants</span>
                                          <span className={variants.length > 0 && mappedVariants < variants.length ? 'text-amber-200' : 'text-cream/70'}>
                                             {mappedVariants}/{variants.length} mapped
                                          </span>
                                          <span className="ml-2 text-cream/35">{variantImageCount} variant images</span>
                                       </div>
                                       <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                          <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-cream/30"><RefreshCw className="w-3 h-3 text-bronze/70" /> Images / Inventory</span>
                                          <span className={imageCount > 0 ? 'text-cream/70' : 'text-red-300'}>{imageCount} image{imageCount === 1 ? '' : 's'}</span>
                                          <span className={`ml-2 ${inventoryStatusClass}`}>{product.cjInventoryStatus || 'CJ not synced'}</span>
                                          {product.cjInventoryTotal !== undefined && <span className="ml-2 text-cream/45">{product.cjInventoryTotal} available</span>}
                                          <span className="block truncate text-cream/30">Checked: {inventoryCheckedAt}</span>
                                       </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                       <button onClick={() => handleSetProductStorefrontStatus(product, 'published')} className="inline-flex items-center gap-1.5 rounded-lg border border-green-400/25 bg-green-500/10 px-3 py-2 text-[10px] uppercase tracking-widest text-green-200 hover:bg-green-500/20">
                                          <Eye className="w-3 h-3" /> Publish
                                       </button>
                                       <button onClick={() => handleSetProductStorefrontStatus(product, 'hidden')} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-widest text-cream/65 hover:bg-white/10">
                                          <EyeOff className="w-3 h-3" /> Hide
                                       </button>
                                       <button onClick={() => handleSetProductStorefrontStatus(product, 'next_launch')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[10px] uppercase tracking-widest text-amber-100 hover:bg-amber-500/20">
                                          <Rocket className="w-3 h-3" /> Next Launch
                                       </button>
                                       <button
                                          onClick={() => handleRefreshProductInventory(product)}
                                          disabled={isRefreshingInventory}
                                          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300/25 bg-sky-500/10 px-3 py-2 text-[10px] uppercase tracking-widest text-sky-100 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                       >
                                          <RefreshCw className={`w-3 h-3 ${isRefreshingInventory ? 'animate-spin' : ''}`} /> Check Stock
                                       </button>
                                       <button onClick={() => handleEditProduct(product)} className="inline-flex items-center gap-1.5 rounded-lg border border-bronze/25 bg-bronze/10 px-3 py-2 text-[10px] uppercase tracking-widest text-bronze hover:bg-bronze/20">
                                          <Edit3 className="w-3 h-3" /> Edit Item
                                       </button>
                                    </div>
                                 </div>

                                 <div className="flex gap-2 flex-shrink-0 z-10 md:self-start">
                                    <button onClick={() => handleEditProduct(product)} aria-label={`Edit ${product.name}`} className="p-2 hover:bg-white/20 rounded-full text-cream"><Edit3 className="w-4 h-4" /></button>
                                    <button onClick={() => handleDeleteProduct(product.id)} aria-label={`Delete ${product.name}`} className="p-2 hover:bg-red-500/20 text-red-400 rounded-full"><Trash2 className="w-4 h-4" /></button>
                                 </div>
                              </div>
                           );
                        })
                     )}
                  </div>
               </FadeIn>
            )}

            {/* JOURNAL TAB */}
            {activeTab === 'journal' && (
               <FadeIn>
                  <div className="flex flex-col md:flex-row gap-3 md:gap-0 justify-between md:items-end mb-8 md:mb-12 border-b border-white/10 pb-4 md:pb-6">
                     <div><span className="text-bronze text-xs uppercase tracking-[0.4em] mb-2 block glow-text">Content Marketing</span><h1 className="font-serif text-2xl md:text-4xl text-cream drop-shadow-md">Simply Mae Journal</h1></div>
                     <button onClick={handleCreateNewPost} className="bg-white/10 text-cream border border-white/20 px-6 py-3 text-[10px] uppercase tracking-[0.2em] hover:bg-white/20 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.3)] flex items-center gap-2 rounded-lg backdrop-blur-md">
                        <Plus className="w-3 h-3" /> New Story
                     </button>
                  </div>
                  <div className="grid grid-cols-1 gap-6">
                     {posts.map(post => (
                        <div key={post.id} className="bg-white/5 backdrop-blur-xl p-4 md:p-6 border border-white/10 rounded-2xl flex gap-4 md:gap-8 items-start group hover:-translate-y-1 hover:bg-white/10 hover:shadow-[0_15px_30px_rgba(0,0,0,0.4)] transition-all overflow-hidden relative">
                           {/* Inner Highlight Base Overlay */}
                           <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-2xl group-hover:border-white/20 transition-colors" />

                           <div className="w-20 md:w-32 aspect-[3/4] bg-black/40 flex-shrink-0 rounded-lg overflow-hidden border border-white/10 shadow-inner z-10">
                              <img src={post.image} className="w-full h-full object-cover opacity-90 group-hover:scale-110 group-hover:opacity-100 transition-all duration-700" />
                           </div>
                           <div className="flex-1 z-10">
                              <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-bronze mb-2"><span>{post.category}</span><span className="w-1 h-1 rounded-full bg-bronze/40 shadow-[0_0_5px_currentColor]"></span><span>{post.date}</span></div>
                              <h3 className="font-serif text-2xl text-cream mb-3 drop-shadow-sm group-hover:text-white transition-colors">{post.title}</h3>
                              <p className="font-sans text-sm text-cream/60 line-clamp-2 mb-4 leading-relaxed">{post.excerpt}</p>
                              <span className={`text-[9px] uppercase tracking-widest px-2 py-1 rounded-sm shadow-sm border ${post.status === 'published' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-white/10 text-cream/60 border-white/20'}`}>{post.status}</span>
                           </div>
                           <div className="flex gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity flex-shrink-0 z-10">
                              <button onClick={() => handleEditPost(post)} aria-label={`Edit ${post.title}`} className="p-2 hover:bg-white/20 rounded-full text-cream transition-colors"><Edit3 className="w-4 h-4" /></button>
                              <button onClick={() => handleDeletePost(post.id)} aria-label={`Delete ${post.title}`} className="p-2 hover:bg-red-500/20 text-red-400 rounded-full transition-colors"><Trash2 className="w-4 h-4" /></button>
                           </div>
                        </div>
                     ))}
                  </div>
               </FadeIn>
            )}

            {/* PAGES TAB */}
            {activeTab === 'pages' && !activePageEditor && (
               <FadeIn>
                  <div className="flex flex-col md:flex-row gap-3 md:gap-0 justify-between md:items-end mb-8 md:mb-12 border-b border-white/10 pb-4 md:pb-6">
                     <div><span className="text-bronze text-xs uppercase tracking-[0.4em] mb-2 block glow-text">Site Design</span><h1 className="font-serif text-2xl md:text-4xl text-cream drop-shadow-md">Select Page to Edit</h1></div>
                     <button onClick={() => setShowPageGenerator(true)} className="bg-white/10 text-cream border border-white/20 px-6 py-3 text-[10px] uppercase tracking-[0.2em] hover:bg-white/20 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.3)] flex items-center gap-2 rounded-lg backdrop-blur-md">
                        <WandIcon className="w-3 h-3 text-bronze" /> Smart New Page
                     </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                     <button onClick={() => setActivePageEditor('home')} className="bg-white/5 backdrop-blur-3xl p-10 border border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.3)] rounded-[2rem] hover:-translate-y-2 hover:bg-white/10 hover:border-bronze/30 transition-all duration-500 cursor-pointer flex flex-col items-center text-center group overflow-hidden relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50">
                        <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-[2rem] group-hover:border-white/10 mix-blend-overlay" />
                        <div className="w-16 h-16 bg-black/40 rounded-full flex items-center justify-center mb-6 shadow-inner border border-white/10 group-hover:bg-black/60 group-hover:scale-110 transition-all duration-500 z-10"><Home className="w-8 h-8 text-bronze drop-shadow-sm group-hover:text-amber-400 transition-colors" /></div>
                        <h3 className="font-serif text-2xl text-cream mb-2 drop-shadow-sm z-10">Home Page</h3>
                     </button>
                     <button onClick={() => setActivePageEditor('story')} className="bg-white/5 backdrop-blur-3xl p-10 border border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.3)] rounded-[2rem] hover:-translate-y-2 hover:bg-white/10 hover:border-bronze/30 transition-all duration-500 cursor-pointer flex flex-col items-center text-center group overflow-hidden relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50">
                        <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-[2rem] group-hover:border-white/10 mix-blend-overlay" />
                        <div className="w-16 h-16 bg-black/40 rounded-full flex items-center justify-center mb-6 shadow-inner border border-white/10 group-hover:bg-black/60 group-hover:scale-110 transition-all duration-500 z-10"><BookOpen className="w-8 h-8 text-bronze drop-shadow-sm group-hover:text-amber-400 transition-colors" /></div>
                        <h3 className="font-serif text-2xl text-cream mb-2 drop-shadow-sm z-10">Our Story</h3>
                     </button>
                     {siteContent.customPages.map(page => (
                        <div key={page.id} className="relative">
                           <div className="absolute top-4 right-4 z-20"><button onClick={(e) => { e.stopPropagation(); handleDeleteCustomPage(page.id); }} className="p-2 hover:bg-red-500/20 text-cream/30 hover:text-red-400 rounded-full transition-colors" aria-label={`Delete ${page.title}`}><Trash2 className="w-4 h-4" /></button></div>
                           <button onClick={() => setActivePageEditor(page.id)} className="bg-white/5 backdrop-blur-3xl p-10 border border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.3)] rounded-[2rem] hover:-translate-y-2 hover:bg-white/10 hover:border-bronze/30 transition-all duration-500 cursor-pointer flex flex-col items-center text-center group overflow-hidden relative w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50">
                              <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-[2rem] group-hover:border-white/10 mix-blend-overlay" />
                              <div className="w-16 h-16 bg-black/40 rounded-full flex items-center justify-center mb-6 shadow-inner border border-white/10 group-hover:bg-black/60 group-hover:scale-110 transition-all duration-500 z-10"><FileText className="w-8 h-8 text-bronze drop-shadow-sm group-hover:text-amber-400 transition-colors" /></div>
                              <h3 className="font-serif text-2xl text-cream mb-2 drop-shadow-sm z-10">{page.title}</h3>
                           </button>
                        </div>
                     ))}
                  </div>
               </FadeIn>
            )}

            {/* Existing AI Page Generator Modal */}
            {showPageGenerator && (
               <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6"><div className="bg-white w-full max-w-lg p-8 rounded-2xl shadow-2xl relative animate-fade-in-up"><button onClick={() => setShowPageGenerator(false)} className="absolute top-4 right-4 text-earth/30 hover:text-earth"><X className="w-5 h-5" /></button><div className="text-center mb-8"><h2 className="font-serif text-2xl text-earth">Design Concierge</h2></div><div className="space-y-6"><div><label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Page Title</label><input type="text" value={generatorPrompt.title} onChange={(e) => setGeneratorPrompt({ ...generatorPrompt, title: e.target.value })} className="w-full p-3 border border-earth/10 bg-cream/20 text-earth focus:border-bronze focus:outline-none rounded-lg" /></div><div><label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Description</label><textarea value={generatorPrompt.description} onChange={(e) => setGeneratorPrompt({ ...generatorPrompt, description: e.target.value })} className="w-full p-3 border border-earth/10 bg-cream/20 text-earth focus:border-bronze focus:outline-none h-32 rounded-lg" /></div><button onClick={handleGeneratePage} disabled={isGenerating} className="w-full bg-earth text-cream py-4 text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-colors flex items-center justify-center gap-2 disabled:opacity-70 rounded-lg">{isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <WandIcon className="w-4 h-4" />}{isGenerating ? 'Designing...' : 'Generate Page'}</button></div></div></div>
            )}

            {/* --- UNIFIED PAGE EDITOR (Home or Custom) --- */}
            {activeTab === 'pages' && typeof activePageEditor === 'string' && activePageEditor !== 'story' && (() => {
               // Determine which sections to edit: CustomPage or Home
               let sections: PageSection[] = [];
               let title = '';
               let updateFunc: (newSections: PageSection[]) => void = () => { };

               if (activePageEditor === 'home') {
                  sections = siteContent.home.sections || [];
                  title = 'Home Page';
                  updateFunc = (newSections) => updateSiteContent('home', { sections: newSections });
               } else {
                  const page = siteContent.customPages.find(p => p.id === activePageEditor);
                  if (!page) return null;
                  sections = page.sections;
                  title = page.title;
                  updateFunc = (newSections) => updateCustomPage(page.id, { sections: newSections });
               }

               return (
                  <div className="max-w-4xl mx-auto pb-20">
                     <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                           <button onClick={() => setActivePageEditor(null)} className="p-2 hover:bg-earth/5 rounded-full"><ArrowLeft className="w-5 h-5 text-earth/50" /></button>
                           <h1 className="font-serif text-3xl text-earth">{title} Editor</h1>
                        </div>
                     </div>

                     {/* Home Page Static Fields (Only show if editing home) */}
                     {activePageEditor === 'home' && (
                        <div className="mb-12 space-y-8 bg-cream/30 p-8 border border-earth/5">
                           <h3 className="font-serif text-xl text-earth mb-4 italic">Core Homepage Elements</h3>
                           <div className="space-y-6">
                              <ImageUploader label="Hero Image" currentImage={siteContent.home.hero.image} onImageChange={(val) => updateSiteContent('home', { hero: { ...siteContent.home.hero, image: val } })} aspectRatio="aspect-[21/9]" />
                              <div className="space-y-6"><div><label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Main Title Line 1</label><input type="text" value={siteContent.home.hero.titleLine1} onChange={(e) => updateSiteContent('home', { hero: { ...siteContent.home.hero, titleLine1: e.target.value } })} className="w-full bg-cream/30 p-3 border border-earth/10 font-serif text-xl" /></div></div>
                           </div>
                           <p className="text-xs text-earth/40 italic">Note: Core category grids and features are fixed. Add dynamic sections below to expand the page.</p>
                        </div>
                     )}

                     <div className="space-y-6">
                        {sections.map((section, idx) => (
                           <div key={section.id} className="bg-white border border-earth/5 shadow-sm p-6 relative group transition-all hover:shadow-md">
                              <div className="flex justify-between items-center mb-6 pb-4 border-b border-earth/5">
                                 <div className="flex items-center gap-3">
                                    <span className="p-2 bg-cream rounded-sm text-earth/50">
                                       {section.type === 'hero' && <ImageIcon className="w-4 h-4" />}
                                       {section.type === 'full-image' && <Maximize className="w-4 h-4" />}
                                       {section.type === 'text' && <Type className="w-4 h-4" />}
                                       {section.type === 'grid' && <Grid className="w-4 h-4" />}
                                       {section.type === 'product-feature' && <Tag className="w-4 h-4" />}
                                       {section.type === 'image-text' && <Layout className="w-4 h-4" />}
                                       {section.type === 'manifesto' && <FileText className="w-4 h-4" />}
                                    </span>
                                    <span className="text-xs uppercase tracking-widest text-bronze font-bold">{section.type.replace('-', ' ')}</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                    <button onClick={() => {
                                       if (idx > 0) {
                                          const newSections = [...sections];
                                          [newSections[idx - 1], newSections[idx]] = [newSections[idx], newSections[idx - 1]];
                                          updateFunc(newSections);
                                       }
                                    }} className="p-2 hover:bg-earth/5 text-earth/30 hover:text-earth disabled:opacity-20" disabled={idx === 0}>↑</button>
                                    <button onClick={() => {
                                       if (idx < sections.length - 1) {
                                          const newSections = [...sections];
                                          [newSections[idx + 1], newSections[idx]] = [newSections[idx], newSections[idx + 1]];
                                          updateFunc(newSections);
                                       }
                                    }} className="p-2 hover:bg-earth/5 text-earth/30 hover:text-earth disabled:opacity-20" disabled={idx === sections.length - 1}>↓</button>
                                    <button onClick={() => { const newSections = sections.filter(s => s.id !== section.id); updateFunc(newSections); }} className="p-2 hover:bg-red-50 text-earth/20 hover:text-red-800 transition-colors ml-2"><Trash2 className="w-4 h-4" /></button>
                                 </div>
                              </div>

                              <div className="space-y-4">
                                 {/* COMMON FIELDS */}
                                 {(section.type !== 'manifesto') && (
                                    <div><label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-1">Heading</label><input type="text" value={section.heading || ''} onChange={(e) => { const newSections = [...sections]; newSections[idx] = { ...section, heading: e.target.value }; updateFunc(newSections); }} className="w-full bg-cream/30 p-2 border border-earth/10 text-sm font-serif text-lg" /></div>
                                 )}

                                 {(section.type === 'text' || section.type === 'image-text' || section.type === 'manifesto') && (
                                    <div><label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-1">Content</label><textarea value={section.content || ''} onChange={(e) => { const newSections = [...sections]; newSections[idx] = { ...section, content: e.target.value }; updateFunc(newSections); }} className="w-full bg-cream/30 p-2 border border-earth/10 text-sm h-24" /></div>
                                 )}

                                 {(section.type === 'hero' || section.type === 'image-text' || section.type === 'full-image') && (
                                    <ImageUploader label="Section Image" currentImage={section.image} onImageChange={(val) => { const newSections = [...sections]; newSections[idx] = { ...section, image: val }; updateFunc(newSections); }} aspectRatio={section.type === 'image-text' ? 'aspect-[3/4]' : 'aspect-[21/9]'} />
                                 )}

                                 {/* PRODUCT FEATURE SPECIFIC */}
                                 {section.type === 'product-feature' && (
                                    <div>
                                       <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-1">Select Product</label>
                                       <select
                                          value={section.productId || ''}
                                          onChange={(e) => { const newSections = [...sections]; newSections[idx] = { ...section, productId: e.target.value }; updateFunc(newSections); }}
                                          className="w-full bg-cream/30 p-3 border border-earth/10 text-sm"
                                       >
                                          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                       </select>
                                    </div>
                                 )}

                                 {/* GRID SPECIFIC */}
                                 {section.type === 'grid' && (
                                    <div className="mt-4 pt-4 border-t border-earth/5">
                                       <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Grid Items</label>
                                       <div className="space-y-4">
                                          {section.items?.map((item, iIdx) => (
                                             <div key={iIdx} className="flex gap-4 items-start bg-cream/20 p-3 border border-earth/5">
                                                <div className="w-16 h-16 bg-white flex-shrink-0 relative group">
                                                   <img src={item.image} className="w-full h-full object-cover" />
                                                   <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={(e) => {
                                                      const file = e.target.files?.[0];
                                                      if (file) {
                                                         const reader = new FileReader();
                                                         reader.onloadend = () => {
                                                            const newSections = [...sections];
                                                            newSections[idx].items![iIdx].image = reader.result as string;
                                                            updateFunc(newSections);
                                                         };
                                                         reader.readAsDataURL(file);
                                                      }
                                                   }} />
                                                </div>
                                                <div className="flex-1 space-y-2">
                                                   <input value={item.title} onChange={(e) => { const newSections = [...sections]; newSections[idx].items![iIdx].title = e.target.value; updateFunc(newSections); }} className="w-full bg-white p-1 border border-earth/10 text-xs" placeholder="Title" />
                                                   <input value={item.subtitle} onChange={(e) => { const newSections = [...sections]; newSections[idx].items![iIdx].subtitle = e.target.value; updateFunc(newSections); }} className="w-full bg-white p-1 border border-earth/10 text-xs" placeholder="Subtitle" />
                                                   <input value={item.link} onChange={(e) => { const newSections = [...sections]; newSections[idx].items![iIdx].link = e.target.value; updateFunc(newSections); }} className="w-full bg-white p-1 border border-earth/10 text-xs font-mono" placeholder="Link (#)" />
                                                </div>
                                                <button onClick={() => { const newSections = [...sections]; newSections[idx].items = section.items?.filter((_, n) => n !== iIdx); updateFunc(newSections); }} className="text-red-800"><Trash2 className="w-4 h-4" /></button>
                                             </div>
                                          ))}
                                          <button onClick={() => { const newSections = [...sections]; newSections[idx].items = [...(section.items || []), { title: 'New Item', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', link: '#' }]; updateFunc(newSections); }} className="text-[10px] uppercase text-bronze hover:underline">+ Add Grid Item</button>
                                       </div>
                                    </div>
                                 )}

                                 {/* LAYOUT OPTIONS */}
                                 {(section.type === 'text') && (
                                    <div className="flex gap-4">
                                       <label className="flex items-center gap-2 cursor-pointer">
                                          <input type="radio" name={`layout-${section.id}`} checked={section.layout === 'center' || !section.layout} onChange={() => { const newSections = [...sections]; newSections[idx] = { ...section, layout: 'center' }; updateFunc(newSections); }} />
                                          <span className="text-[10px] uppercase tracking-widest text-earth/60">Center</span>
                                       </label>
                                       <label className="flex items-center gap-2 cursor-pointer">
                                          <input type="radio" name={`layout-${section.id}`} checked={section.layout === 'left'} onChange={() => { const newSections = [...sections]; newSections[idx] = { ...section, layout: 'left' }; updateFunc(newSections); }} />
                                          <span className="text-[10px] uppercase tracking-widest text-earth/60">Left</span>
                                       </label>
                                    </div>
                                 )}
                              </div>
                           </div>
                        ))}

                        <button
                           onClick={() => setShowSectionPicker(true)}
                           className="w-full py-8 border-2 border-dashed border-earth/20 text-earth/40 hover:text-earth hover:border-earth/40 hover:bg-white/40 transition-all flex flex-col items-center justify-center gap-2"
                        >
                           <Plus className="w-6 h-6" />
                           <span className="text-xs uppercase tracking-widest">Add Content Section</span>
                        </button>
                     </div>
                  </div>
               );
            })()}

            {/* STORY PAGE EDITOR */}
            {activeTab === 'pages' && activePageEditor === 'story' && (() => {
               const sections = siteContent.story.sections || [];
               const updateFunc = (newSections: PageSection[]) => updateSiteContent('story', { sections: newSections });

               return (
                  <div className="max-w-4xl mx-auto pb-20">
                     <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                           <button onClick={() => setActivePageEditor(null)} className="p-2 hover:bg-earth/5 rounded-full"><ArrowLeft className="w-5 h-5 text-earth/50" /></button>
                           <h1 className="font-serif text-3xl text-earth">Our Story Editor</h1>
                        </div>
                     </div>

                     <div className="space-y-8 mb-12">
                        {/* Hero Section */}
                        <div className="bg-white p-8 border border-earth/5 shadow-sm">
                           <h3 className="font-serif text-xl text-earth mb-6 border-b border-earth/10 pb-2">Hero Section</h3>
                           <div className="space-y-6">
                              <ImageUploader
                                 label="Hero Image"
                                 currentImage={siteContent.story.hero.image}
                                 onImageChange={(val) => updateSiteContent('story', { hero: { ...siteContent.story.hero, image: val } })}
                                 aspectRatio="aspect-[21/9]"
                              />
                              <div className="grid grid-cols-2 gap-6">
                                 <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Title</label>
                                    <input
                                       type="text"
                                       value={siteContent.story.hero.title}
                                       onChange={(e) => updateSiteContent('story', { hero: { ...siteContent.story.hero, title: e.target.value } })}
                                       className="w-full bg-cream/30 p-3 border border-earth/10 font-serif text-xl"
                                    />
                                 </div>
                                 <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Subtitle</label>
                                    <input
                                       type="text"
                                       value={siteContent.story.hero.subtitle}
                                       onChange={(e) => updateSiteContent('story', { hero: { ...siteContent.story.hero, subtitle: e.target.value } })}
                                       className="w-full bg-cream/30 p-3 border border-earth/10 font-serif text-xl italic"
                                    />
                                 </div>
                              </div>
                           </div>
                        </div>

                        {/* Prologue Section */}
                        <div className="bg-white p-8 border border-earth/5 shadow-sm">
                           <h3 className="font-serif text-xl text-earth mb-6 border-b border-earth/10 pb-2">Prologue</h3>
                           <div className="space-y-6">
                              <div>
                                 <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Main Quote</label>
                                 <textarea
                                    value={siteContent.story.prologue.quote}
                                    onChange={(e) => updateSiteContent('story', { prologue: { ...siteContent.story.prologue, quote: e.target.value } })}
                                    className="w-full bg-cream/30 p-3 border border-earth/10 font-serif text-lg h-24"
                                 />
                              </div>
                              <div>
                                 <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Subtext</label>
                                 <input
                                    type="text"
                                    value={siteContent.story.prologue.subtext}
                                    onChange={(e) => updateSiteContent('story', { prologue: { ...siteContent.story.prologue, subtext: e.target.value } })}
                                    className="w-full bg-cream/30 p-3 border border-earth/10 text-xs uppercase tracking-widest"
                                 />
                              </div>
                           </div>
                        </div>

                        {/* Chapters Section */}
                        <div className="bg-white p-8 border border-earth/5 shadow-sm">
                           <h3 className="font-serif text-xl text-earth mb-6 border-b border-earth/10 pb-2">Chapters</h3>
                           <div className="space-y-8">
                              {/* Chapter I */}
                              <div className="bg-cream/20 p-6 border border-earth/5">
                                 <span className="text-bronze font-serif italic mb-4 block">Chapter I</span>
                                 <div className="space-y-4">
                                    <input
                                       type="text"
                                       value={siteContent.story.chapters.oneTitle}
                                       onChange={(e) => updateSiteContent('story', { chapters: { ...siteContent.story.chapters, oneTitle: e.target.value } })}
                                       className="w-full bg-white p-3 border border-earth/10 font-serif text-lg"
                                       placeholder="Title"
                                    />
                                    <textarea
                                       value={siteContent.story.chapters.oneText}
                                       onChange={(e) => updateSiteContent('story', { chapters: { ...siteContent.story.chapters, oneText: e.target.value } })}
                                       className="w-full bg-white p-3 border border-earth/10 h-32 text-sm leading-relaxed"
                                       placeholder="Content"
                                    />
                                 </div>
                              </div>

                              {/* Chapter II */}
                              <div className="bg-cream/20 p-6 border border-earth/5">
                                 <span className="text-bronze font-serif italic mb-4 block">Chapter II</span>
                                 <div className="space-y-4">
                                    <input
                                       type="text"
                                       value={siteContent.story.chapters.twoTitle}
                                       onChange={(e) => updateSiteContent('story', { chapters: { ...siteContent.story.chapters, twoTitle: e.target.value } })}
                                       className="w-full bg-white p-3 border border-earth/10 font-serif text-lg"
                                       placeholder="Title"
                                    />
                                    <textarea
                                       value={siteContent.story.chapters.twoText}
                                       onChange={(e) => updateSiteContent('story', { chapters: { ...siteContent.story.chapters, twoText: e.target.value } })}
                                       className="w-full bg-white p-3 border border-earth/10 h-32 text-sm leading-relaxed"
                                       placeholder="Content"
                                    />
                                 </div>
                              </div>

                              {/* Chapter III */}
                              <div className="bg-cream/20 p-6 border border-earth/5">
                                 <span className="text-bronze font-serif italic mb-4 block">Chapter III</span>
                                 <div className="space-y-4">
                                    <input
                                       type="text"
                                       value={siteContent.story.chapters.threeTitle}
                                       onChange={(e) => updateSiteContent('story', { chapters: { ...siteContent.story.chapters, threeTitle: e.target.value } })}
                                       className="w-full bg-white p-3 border border-earth/10 font-serif text-lg"
                                       placeholder="Title"
                                    />
                                    <textarea
                                       value={siteContent.story.chapters.threeText}
                                       onChange={(e) => updateSiteContent('story', { chapters: { ...siteContent.story.chapters, threeText: e.target.value } })}
                                       className="w-full bg-white p-3 border border-earth/10 h-32 text-sm leading-relaxed"
                                       placeholder="Content"
                                    />
                                 </div>
                              </div>

                              {/* Chapter IV */}
                              <div className="bg-cream/20 p-6 border border-earth/5">
                                 <span className="text-bronze font-serif italic mb-4 block">Chapter IV</span>
                                 <div className="space-y-4">
                                    <input
                                       type="text"
                                       value={siteContent.story.chapters.fourTitle}
                                       onChange={(e) => updateSiteContent('story', { chapters: { ...siteContent.story.chapters, fourTitle: e.target.value } })}
                                       className="w-full bg-white p-3 border border-earth/10 font-serif text-lg"
                                       placeholder="Title"
                                    />
                                    <textarea
                                       value={siteContent.story.chapters.fourText}
                                       onChange={(e) => updateSiteContent('story', { chapters: { ...siteContent.story.chapters, fourText: e.target.value } })}
                                       className="w-full bg-white p-3 border border-earth/10 h-32 text-sm leading-relaxed"
                                       placeholder="Content"
                                    />
                                 </div>
                              </div>
                           </div>
                        </div>
                     </div>

                     {/* DYNAMIC SECTIONS UI */}
                     <div className="space-y-6 pt-12 border-t border-earth/10">
                        <h3 className="font-serif text-2xl text-earth mb-6">Additional Content Sections</h3>
                        {sections.map((section, idx) => (
                           <div key={section.id} className="bg-white border border-earth/5 shadow-sm p-6 relative group transition-all hover:shadow-md">
                              <div className="flex justify-between items-center mb-6 pb-4 border-b border-earth/5">
                                 <div className="flex items-center gap-3">
                                    <span className="p-2 bg-cream rounded-sm text-earth/50">
                                       {section.type === 'hero' && <ImageIcon className="w-4 h-4" />}
                                       {section.type === 'full-image' && <Maximize className="w-4 h-4" />}
                                       {section.type === 'text' && <Type className="w-4 h-4" />}
                                       {section.type === 'grid' && <Grid className="w-4 h-4" />}
                                       {section.type === 'product-feature' && <Tag className="w-4 h-4" />}
                                       {section.type === 'image-text' && <Layout className="w-4 h-4" />}
                                       {section.type === 'manifesto' && <FileText className="w-4 h-4" />}
                                    </span>
                                    <span className="text-xs uppercase tracking-widest text-bronze font-bold">{section.type.replace('-', ' ')}</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                    <button onClick={() => {
                                       if (idx > 0) {
                                          const newSections = [...sections];
                                          [newSections[idx - 1], newSections[idx]] = [newSections[idx], newSections[idx - 1]];
                                          updateFunc(newSections);
                                       }
                                    }} className="p-2 hover:bg-earth/5 text-earth/30 hover:text-earth disabled:opacity-20" disabled={idx === 0}>↑</button>
                                    <button onClick={() => {
                                       if (idx < sections.length - 1) {
                                          const newSections = [...sections];
                                          [newSections[idx + 1], newSections[idx]] = [newSections[idx], newSections[idx + 1]];
                                          updateFunc(newSections);
                                       }
                                    }} className="p-2 hover:bg-earth/5 text-earth/30 hover:text-earth disabled:opacity-20" disabled={idx === sections.length - 1}>↓</button>
                                    <button onClick={() => { const newSections = sections.filter(s => s.id !== section.id); updateFunc(newSections); }} className="p-2 hover:bg-red-50 text-earth/20 hover:text-red-800 transition-colors ml-2"><Trash2 className="w-4 h-4" /></button>
                                 </div>
                              </div>

                              <div className="space-y-4">
                                 {/* COMMON FIELDS */}
                                 {(section.type !== 'manifesto') && (
                                    <div><label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-1">Heading</label><input type="text" value={section.heading || ''} onChange={(e) => { const newSections = [...sections]; newSections[idx] = { ...section, heading: e.target.value }; updateFunc(newSections); }} className="w-full bg-cream/30 p-2 border border-earth/10 text-sm font-serif text-lg" /></div>
                                 )}

                                 {(section.type === 'text' || section.type === 'image-text' || section.type === 'manifesto') && (
                                    <div><label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-1">Content</label><textarea value={section.content || ''} onChange={(e) => { const newSections = [...sections]; newSections[idx] = { ...section, content: e.target.value }; updateFunc(newSections); }} className="w-full bg-cream/30 p-2 border border-earth/10 text-sm h-24" /></div>
                                 )}

                                 {(section.type === 'hero' || section.type === 'image-text' || section.type === 'full-image') && (
                                    <ImageUploader label="Section Image" currentImage={section.image} onImageChange={(val) => { const newSections = [...sections]; newSections[idx] = { ...section, image: val }; updateFunc(newSections); }} aspectRatio={section.type === 'image-text' ? 'aspect-[3/4]' : 'aspect-[21/9]'} />
                                 )}

                                 {/* PRODUCT FEATURE SPECIFIC */}
                                 {section.type === 'product-feature' && (
                                    <div>
                                       <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-1">Select Product</label>
                                       <select
                                          value={section.productId || ''}
                                          onChange={(e) => { const newSections = [...sections]; newSections[idx] = { ...section, productId: e.target.value }; updateFunc(newSections); }}
                                          className="w-full bg-cream/30 p-3 border border-earth/10 text-sm"
                                       >
                                          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                       </select>
                                    </div>
                                 )}

                                 {/* GRID SPECIFIC */}
                                 {section.type === 'grid' && (
                                    <div className="mt-4 pt-4 border-t border-earth/5">
                                       <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Grid Items</label>
                                       <div className="space-y-4">
                                          {section.items?.map((item, iIdx) => (
                                             <div key={iIdx} className="flex gap-4 items-start bg-cream/20 p-3 border border-earth/5">
                                                <div className="w-16 h-16 bg-white flex-shrink-0 relative group">
                                                   <img src={item.image} className="w-full h-full object-cover" />
                                                   <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={(e) => {
                                                      const file = e.target.files?.[0];
                                                      if (file) {
                                                         const reader = new FileReader();
                                                         reader.onloadend = () => {
                                                            const newSections = [...sections];
                                                            newSections[idx].items![iIdx].image = reader.result as string;
                                                            updateFunc(newSections);
                                                         };
                                                         reader.readAsDataURL(file);
                                                      }
                                                   }} />
                                                </div>
                                                <div className="flex-1 space-y-2">
                                                   <input value={item.title} onChange={(e) => { const newSections = [...sections]; newSections[idx].items![iIdx].title = e.target.value; updateFunc(newSections); }} className="w-full bg-white p-1 border border-earth/10 text-xs" placeholder="Title" />
                                                   <input value={item.subtitle} onChange={(e) => { const newSections = [...sections]; newSections[idx].items![iIdx].subtitle = e.target.value; updateFunc(newSections); }} className="w-full bg-white p-1 border border-earth/10 text-xs" placeholder="Subtitle" />
                                                   <input value={item.link} onChange={(e) => { const newSections = [...sections]; newSections[idx].items![iIdx].link = e.target.value; updateFunc(newSections); }} className="w-full bg-white p-1 border border-earth/10 text-xs font-mono" placeholder="Link (#)" />
                                                </div>
                                                <button onClick={() => { const newSections = [...sections]; newSections[idx].items = section.items?.filter((_, n) => n !== iIdx); updateFunc(newSections); }} className="text-red-800"><Trash2 className="w-4 h-4" /></button>
                                             </div>
                                          ))}
                                          <button onClick={() => { const newSections = [...sections]; newSections[idx].items = [...(section.items || []), { title: 'New Item', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', link: '#' }]; updateFunc(newSections); }} className="text-[10px] uppercase text-bronze hover:underline">+ Add Grid Item</button>
                                       </div>
                                    </div>
                                 )}

                                 {/* LAYOUT OPTIONS */}
                                 {(section.type === 'text') && (
                                    <div className="flex gap-4">
                                       <label className="flex items-center gap-2 cursor-pointer">
                                          <input type="radio" name={`layout-${section.id}`} checked={section.layout === 'center' || !section.layout} onChange={() => { const newSections = [...sections]; newSections[idx] = { ...section, layout: 'center' }; updateFunc(newSections); }} />
                                          <span className="text-[10px] uppercase tracking-widest text-earth/60">Center</span>
                                       </label>
                                       <label className="flex items-center gap-2 cursor-pointer">
                                          <input type="radio" name={`layout-${section.id}`} checked={section.layout === 'left'} onChange={() => { const newSections = [...sections]; newSections[idx] = { ...section, layout: 'left' }; updateFunc(newSections); }} />
                                          <span className="text-[10px] uppercase tracking-widest text-earth/60">Left</span>
                                       </label>
                                    </div>
                                 )}
                              </div>
                           </div>
                        ))}

                        <button
                           onClick={() => setShowSectionPicker(true)}
                           className="w-full py-8 border-2 border-dashed border-earth/20 text-earth/40 hover:text-earth hover:border-earth/40 hover:bg-white/40 transition-all flex flex-col items-center justify-center gap-2"
                        >
                           <Plus className="w-6 h-6" />
                           <span className="text-xs uppercase tracking-widest">Add Content Section</span>
                        </button>
                     </div>
                  </div>
               );
            })()}

            {/* SECTION BUILDER MODAL */}
            {showSectionPicker && (
               <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
                  <div className="bg-white w-full max-w-lg md:max-w-4xl p-6 md:p-8 rounded-2xl shadow-2xl relative animate-fade-in-up">
                     <button onClick={() => setShowSectionPicker(false)} className="absolute top-4 right-4 text-earth/30 hover:text-earth"><X className="w-6 h-6" /></button>
                     <div className="mb-8 text-center">
                        <span className="text-bronze text-xs uppercase tracking-[0.3em] block mb-2">Section Builder</span>
                        <h2 className="font-serif text-3xl text-earth">Choose Content Block</h2>
                     </div>
                     <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                        <button onClick={() => handleAddSection('text')} className="p-8 border border-earth/10 hover:border-earth/30 hover:bg-cream/30 transition-all text-center group">
                           <Type className="w-8 h-8 mx-auto mb-4 text-earth/60 group-hover:text-bronze" />
                           <h3 className="font-serif text-xl text-earth mb-1">Text Block</h3>
                           <p className="text-[10px] uppercase tracking-widest text-earth/40">Headings & Paragraphs</p>
                        </button>
                        <button onClick={() => handleAddSection('image-text')} className="p-8 border border-earth/10 hover:border-earth/30 hover:bg-cream/30 transition-all text-center group">
                           <Layout className="w-8 h-8 mx-auto mb-4 text-earth/60 group-hover:text-bronze" />
                           <h3 className="font-serif text-xl text-earth mb-1">Image + Text</h3>
                           <p className="text-[10px] uppercase tracking-widest text-earth/40">Split Layout</p>
                        </button>
                        <button onClick={() => handleAddSection('hero')} className="p-8 border border-earth/10 hover:border-earth/30 hover:bg-cream/30 transition-all text-center group">
                           <ImageIcon className="w-8 h-8 mx-auto mb-4 text-earth/60 group-hover:text-bronze" />
                           <h3 className="font-serif text-xl text-earth mb-1">Hero Image</h3>
                           <p className="text-[10px] uppercase tracking-widest text-earth/40">Large Banner</p>
                        </button>
                        <button onClick={() => handleAddSection('full-image')} className="p-8 border border-earth/10 hover:border-earth/30 hover:bg-cream/30 transition-all text-center group">
                           <Maximize className="w-8 h-8 mx-auto mb-4 text-earth/60 group-hover:text-bronze" />
                           <h3 className="font-serif text-xl text-earth mb-1">Full Screen Image</h3>
                           <p className="text-[10px] uppercase tracking-widest text-earth/40">Immersive Visual</p>
                        </button>
                        <button onClick={() => handleAddSection('grid')} className="p-8 border border-earth/10 hover:border-earth/30 hover:bg-cream/30 transition-all text-center group">
                           <Grid className="w-8 h-8 mx-auto mb-4 text-earth/60 group-hover:text-bronze" />
                           <h3 className="font-serif text-xl text-earth mb-1">Grid</h3>
                           <p className="text-[10px] uppercase tracking-widest text-earth/40">Category Boxes</p>
                        </button>
                        <button onClick={() => handleAddSection('product-feature')} className="p-8 border border-earth/10 hover:border-earth/30 hover:bg-cream/30 transition-all text-center group">
                           <Tag className="w-8 h-8 mx-auto mb-4 text-earth/60 group-hover:text-bronze" />
                           <h3 className="font-serif text-xl text-earth mb-1">Featured Product</h3>
                           <p className="text-[10px] uppercase tracking-widest text-earth/40">Highlight Item</p>
                        </button>
                        <button onClick={() => handleAddSection('manifesto')} className="p-8 border border-earth/10 hover:border-earth/30 hover:bg-cream/30 transition-all text-center group">
                           <FileText className="w-8 h-8 mx-auto mb-4 text-earth/60 group-hover:text-bronze" />
                           <h3 className="font-serif text-xl text-earth mb-1">Manifesto</h3>
                           <p className="text-[10px] uppercase tracking-widest text-earth/40">Quote Box</p>
                        </button>
                     </div>
                  </div>
               </div>
            )}

         </main>

         {/* CAMPAIGN STUDIO — rendered outside <main> for full viewport centering */}
         <NewsletterStudio
            isOpen={!!editingCampaign}
            onClose={() => setEditingCampaign(null)}
            initialCampaign={editingCampaign}
            onSave={(campaign) => {
               if (campaign.id) {
                  updateCampaign(campaign.id, campaign);
               } else {
                  createCampaign(campaign as Omit<EmailCampaign, 'id' | 'stats' | 'status'>);
               }
               // If status is sent, trigger send logic
               if (campaign.status === 'sent' && campaign.id) {
                  sendCampaign(campaign.id);
               }
               setEditingCampaign(null);
            }}
         />

         {/* PRODUCT STUDIO — rendered outside <main> for full viewport centering */}
         <ProductStudio
            isOpen={isEditingProduct}
            onClose={() => { setIsEditingProduct(false); setEditingProduct(null); }}
            initialProduct={editingProduct}
            onSave={async (prod) => {
               if (prod.id) {
                  // Updating existing product - just update
                  await updateProduct(prod.id, prod);
                  if (prod.smartDescription?.auditId) {
                     try {
                        await linkDescriptionAuditToProduct({
                           auditId: prod.smartDescription.auditId as any,
                           productId: prod.id as any,
                        });
                     } catch (err) {
                        console.warn('Failed to link smart description audit:', err);
                     }
                  }
               } else {
                  // New product - set CJ sourcing status if it has a source URL
                  const productWithSourcing = {
                     ...prod,
                     // Mark for CJ sourcing if product has a source URL (from AliExpress etc)
                     cjSourcingStatus: prod.sourceUrl ? 'pending' as const : 'none' as const,
                  };
                  const productId = await addProduct(productWithSourcing as Omit<Product, 'id'>);
                  if (productId && prod.smartDescription?.auditId) {
                     try {
                        await linkDescriptionAuditToProduct({
                           auditId: prod.smartDescription.auditId as any,
                           productId: productId as any,
                        });
                     } catch (err) {
                        console.warn('Failed to link smart description audit:', err);
                     }
                  }

                  // If marked as pending, the CJ cron job will handle submission
                  if (prod.sourceUrl) {
                     alert('Product saved! It is queued for CJ sourcing and will stay hidden until you publish it or add it to a launch.');
                  }
               }
               setIsEditingProduct(false);
               setEditingProduct(null);
            }}
            siteContent={siteContent}
         />

         {/* POST EDITOR MODAL — rendered outside <main> to avoid z-10 stacking context clipping */}
         {isEditingPost && editingPost && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
               <div className="bg-white w-full max-w-4xl max-h-[95vh] md:max-h-[90vh] flex flex-col rounded-2xl shadow-2xl relative animate-fade-in-up">
                  {/* Sticky Header */}
                  <div className="flex items-center justify-between px-4 md:px-8 pt-6 md:pt-8 pb-4 border-b border-earth/5 flex-shrink-0">
                     <h2 className="font-serif text-2xl md:text-3xl text-earth">{editingPost.id ? 'Edit Story' : 'New Story'}</h2>
                     <button onClick={() => setIsEditingPost(false)} className="text-earth/30 hover:text-earth"><X className="w-6 h-6" /></button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="overflow-y-auto flex-1 px-4 md:px-8 py-6">
                     <div className="space-y-6">
                        <ImageUploader label="Cover Image" currentImage={editingPost.image} onImageChange={(val) => setEditingPost({ ...editingPost, image: val })} aspectRatio="aspect-[21/9]" />

                        <div>
                           <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Title</label>
                           <input type="text" value={editingPost.title} onChange={(e) => setEditingPost({ ...editingPost, title: e.target.value })} className="w-full bg-cream/30 p-3 border border-earth/10 font-serif text-2xl" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                           <div>
                              <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Category</label>
                              <select value={editingPost.category} onChange={(e) => setEditingPost({ ...editingPost, category: e.target.value })} className="w-full bg-cream/30 p-3 border border-earth/10">
                                 <option>Lifestyle</option>
                                 <option>Design</option>
                                 <option>Faith</option>
                                 <option>Motherhood</option>
                              </select>
                           </div>
                           <div>
                              <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Status</label>
                              <select value={editingPost.status} onChange={(e) => setEditingPost({ ...editingPost, status: e.target.value as 'draft' | 'published' })} className="w-full bg-cream/30 p-3 border border-earth/10">
                                 <option value="draft">Draft</option>
                                 <option value="published">Published</option>
                              </select>
                           </div>
                        </div>

                        {/* Excerpt Section with AI Generator */}
                        <div>
                           <div className="flex items-center justify-between mb-2">
                              <label className="block text-[10px] uppercase tracking-widest text-earth/40">Excerpt</label>
                              {editingPost.content && editingPost.content.length > 50 && (
                                 <button
                                    type="button"
                                    onClick={async () => {
                                       setExcerptGenerating(true);
                                       setExcerptOptions([]);
                                       try {
                                           const options = await generateBlogExcerpts({
                                              content: editingPost.content,
                                           });
                                           setExcerptOptions(options);
                                       } catch (err) {
                                          console.error('Excerpt generation failed:', err);
                                          alert('Failed to generate excerpts. Please try again.');
                                       } finally {
                                          setExcerptGenerating(false);
                                       }
                                    }}
                                    disabled={excerptGenerating}
                                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-bronze hover:text-earth transition-colors disabled:opacity-50"
                                 >
                                    {excerptGenerating ? (
                                       <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
                                    ) : (
                                       <><WandIcon className="w-3 h-3" /> Generate Excerpts</>
                                    )}
                                 </button>
                              )}
                           </div>
                           <textarea value={editingPost.excerpt} onChange={(e) => setEditingPost({ ...editingPost, excerpt: e.target.value })} className="w-full bg-cream/30 p-3 border border-earth/10 h-24" />

                           {/* Smart Excerpt Options */}
                           {excerptOptions.length > 0 && (
                              <div className="mt-3 space-y-2">
                                 <p className="text-[9px] uppercase tracking-widest text-earth/30 mb-2">Choose an excerpt:</p>
                                 {excerptOptions.map((opt, idx: number) => (
                                    <button
                                       key={idx}
                                       type="button"
                                       onClick={() => {
                                          setEditingPost({ ...editingPost, excerpt: opt.text });
                                          setExcerptOptions([]);
                                       }}
                                       className="w-full text-left p-3 border border-earth/10 rounded-lg hover:border-bronze/40 hover:bg-cream/30 transition-all group"
                                    >
                                       <span className="text-[9px] uppercase tracking-widest text-bronze/60 group-hover:text-bronze block mb-1">{opt.style}</span>
                                       <span className="font-serif text-sm text-earth/80 leading-relaxed">{opt.text}</span>
                                    </button>
                                 ))}
                              </div>
                           )}
                        </div>

                        <div>
                           <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Content</label>
                           <RichTextEditor
                              value={editingPost.content || ''}
                              onChange={(html) => setEditingPost({ ...editingPost, content: html })}
                              placeholder="Start writing your story..."
                           />
                        </div>
                     </div>
                  </div>

                  {/* Sticky Save Button */}
                  <div className="px-4 md:px-8 py-4 border-t border-earth/10 bg-white flex-shrink-0 rounded-b-2xl">
                     <button onClick={handleSavePost} className="w-full bg-earth text-cream py-4 text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-colors rounded-lg">Save Story</button>
                  </div>
               </div>
            </div>
         )}
      </div>
   );
};
