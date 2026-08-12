
import React, { createContext, useContext, ReactNode, useEffect, useRef } from 'react';
import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import { Id } from '../convex/_generated/dataModel';
import { BlogPost, SiteContent, CustomPage, Product, NavLink, CollectionConfig } from '../types';
import { BLOG_POSTS as INITIAL_POSTS, INITIAL_SITE_CONTENT, PRODUCTS as INITIAL_PRODUCTS } from '../constants';

interface SiteContextType {
  posts: BlogPost[];
  products: Product[];
  siteContent: SiteContent;
  isLoading: boolean;  // True while Convex data is loading
  isAuthenticated: boolean;
  isAuthLoading: boolean;  // True while auth state is loading
  signIn: (email: string, password: string, flow: 'signIn' | 'signUp') => Promise<void>;
  logout: () => void;
  // Blog Actions
  addPost: (post: Omit<BlogPost, 'id' | 'date'>) => void;
  updatePost: (id: string, post: Partial<BlogPost>) => void;
  deletePost: (id: string) => void;
  getPost: (id: string) => BlogPost | undefined;
  // Product Actions
  addProduct: (product: Omit<Product, 'id'>) => Promise<string | null>;
  updateProduct: (id: string, product: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  // Site Content Actions
  updateSiteContent: (section: keyof SiteContent, data: Partial<SiteContent[keyof SiteContent]>) => void;
  // Custom Page Actions
  addCustomPage: (page: CustomPage) => void;
  updateCustomPage: (id: string, page: Partial<CustomPage>) => void;
  deleteCustomPage: (id: string) => void;
  getCustomPage: (slug: string) => CustomPage | undefined;
  // Navigation & Collection Actions
  updateNavigation: (navLinks: NavLink[]) => void;
  addCollection: (collection: CollectionConfig) => void;
  updateCollection: (id: string, collection: Partial<CollectionConfig>) => void;
  deleteCollection: (id: string) => void;
}

const SiteContext = createContext<SiteContextType | undefined>(undefined);

export const SiteProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // --- Auth State (using Convex Auth) ---
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const { signIn: authSignIn, signOut: authSignOut } = useAuthActions();

  // --- Convex Queries ---
  const adminPosts = useQuery(api.blogPosts.listAdmin, isAuthenticated ? {} : 'skip');
  const publicPosts = useQuery(api.blogPosts.list, isAuthenticated ? 'skip' : {});
  const convexPosts = isAuthenticated ? adminPosts : publicPosts;
  const adminProducts = useQuery(api.products.list, isAuthenticated ? {} : 'skip');
  const storefrontProducts = useQuery(api.products.listForStorefront, isAuthenticated ? 'skip' : {});
  const convexProducts = isAuthenticated ? adminProducts : storefrontProducts;
  const convexSiteContent = useQuery(api.siteContent.get);
  const convexCustomPages = useQuery(api.customPages.list);

  // --- Convex Mutations ---
  const createPost = useMutation(api.blogPosts.create);
  const updatePostMutation = useMutation(api.blogPosts.update);
  const removePost = useMutation(api.blogPosts.remove);

  const createProduct = useMutation(api.products.create);
  const updateProductMutation = useMutation(api.products.update);
  const removeProduct = useMutation(api.products.remove);

  const updateSiteContentMutation = useMutation(api.siteContent.update);
  const seedSiteContent = useMutation(api.siteContent.seed);

  const createCustomPage = useMutation(api.customPages.create);
  const updateCustomPageMutation = useMutation(api.customPages.update);
  const removeCustomPage = useMutation(api.customPages.remove);
  const siteContentSeedStarted = useRef(false);
  const productSeedStarted = useRef(false);
  const postSeedStarted = useRef(false);

  // --- Seed initial data if Convex is empty ---
  useEffect(() => {
    if (isAuthenticated && convexSiteContent === null && !siteContentSeedStarted.current) {
      siteContentSeedStarted.current = true;
      void seedSiteContent({
        navLinks: INITIAL_SITE_CONTENT.navLinks,
        collections: INITIAL_SITE_CONTENT.collections,
        home: INITIAL_SITE_CONTENT.home,
        story: INITIAL_SITE_CONTENT.story,
      }).catch(error => console.error('Site content seeding failed:', error));
    }
  }, [isAuthenticated, convexSiteContent, seedSiteContent]);

  useEffect(() => {
    if (isAuthenticated && adminProducts?.length === 0 && !productSeedStarted.current) {
      productSeedStarted.current = true;
      void Promise.all(INITIAL_PRODUCTS.map(product => {
        const { id, ...productData } = product;
        return createProduct(productData);
      })).catch(error => console.error('Product seeding failed:', error));
    }
  }, [isAuthenticated, adminProducts, createProduct]);

  useEffect(() => {
    if (isAuthenticated && adminPosts?.length === 0 && !postSeedStarted.current) {
      postSeedStarted.current = true;
      void Promise.all(INITIAL_POSTS.map(post => {
        const { id, date, ...postData } = post;
        return createPost(postData);
      })).catch(error => console.error('Blog post seeding failed:', error));
    }
  }, [isAuthenticated, adminPosts, createPost]);

  // --- Transform Convex data to match existing types ---
  const posts: BlogPost[] = (convexPosts ?? []).map(p => ({
    ...p,
    id: p._id,
  }));

  const products: Product[] = (convexProducts ?? []).map((p): Product => ({
    ...p,
    id: p._id,
  }));

  const customPages: CustomPage[] = (convexCustomPages ?? []).map(p => ({
    ...p,
    id: p._id,
  }));

  // Deep merge utility for siteContent construction
  const deepMergeContent = (target: any, source: any): any => {
    if (!source) return target;
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] === undefined || source[key] === null) continue;
      if (
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        output[key] = deepMergeContent(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  };

  const siteContent: SiteContent = convexSiteContent
    ? {
      navLinks: convexSiteContent.navLinks ?? INITIAL_SITE_CONTENT.navLinks,
      collections: convexSiteContent.collections ?? INITIAL_SITE_CONTENT.collections,
      // Deep merge home and story to preserve nested defaults while applying Convex updates
      // But prioritize Convex hero image directly to avoid showing stale fallback
      home: {
        ...deepMergeContent(INITIAL_SITE_CONTENT.home, convexSiteContent.home),
        hero: {
          ...deepMergeContent(INITIAL_SITE_CONTENT.home.hero, convexSiteContent.home?.hero),
          // Use Convex image directly if available, otherwise use default
          image: convexSiteContent.home?.hero?.image || INITIAL_SITE_CONTENT.home.hero.image,
        }
      },
      story: deepMergeContent(INITIAL_SITE_CONTENT.story, convexSiteContent.story),
      customPages,
    }
    : { ...INITIAL_SITE_CONTENT, customPages };

  // Track loading state - undefined means still loading from Convex
  const isLoading = convexSiteContent === undefined;

  // --- Auth ---
  const signIn = async (email: string, password: string, flow: 'signIn' | 'signUp') => {
    const formData = new FormData();
    formData.append('email', email);
    formData.append('password', password);
    formData.append('flow', flow);
    await authSignIn('password', formData);
  };

  const logout = () => {
    void authSignOut();
  };

  // --- Blog Actions ---
  const addPost = (newPostData: Omit<BlogPost, 'id' | 'date'>) => {
    createPost(newPostData);
  };

  const updatePost = (id: string, updatedData: Partial<BlogPost>) => {
    const { id: _, date, _id, _creationTime, ...updates } = updatedData as any;
    updatePostMutation({ id: id as Id<"blogPosts">, ...updates });
  };

  const deletePost = (id: string) => {
    removePost({ id: id as Id<"blogPosts"> });
  };

  const getPost = (id: string) => {
    return posts.find(post => post.id === id);
  };

  // --- Product Actions ---
  const addProduct = async (newProductData: Omit<Product, 'id'>): Promise<string | null> => {
    try {
      const productId = await createProduct(newProductData);
      return productId as string;
    } catch (error) {
      console.error('Failed to create product:', error);
      return null;
    }
  };

  const updateProduct = (id: string, updatedData: Partial<Product>) => {
    const allowedFields = [
      'name',
      'price',
      'description',
      'images',
      'category',
      'collection',
      'isNew',
      'inStock',
      'publishedAt',
      'storefrontStatus',
      'launchBatchId',
      'launchAddedAt',
      'launchedAt',
      'variants',
      'sourceUrl',
      'cjSourcingStatus',
      'cjVariantId',
      'cjSku',
      'cjProductId',
      'cjInventoryStatus',
      'cjInventoryTotal',
      'cjInventoryLastCheckedAt',
      'cjInventoryError',
      'cjInventoryByVariant',
      'sourcePriceCny',
      'estimatedCjCost',
      'estimatedShipping',
      'pricingStage',
      'subcategory',
      'smartDescription',
      'descriptionSource',
      'descriptionFingerprint',
    ];
    const updates = Object.fromEntries(
      allowedFields
        .filter((field) => Object.prototype.hasOwnProperty.call(updatedData, field))
        .map((field) => [field, (updatedData as any)[field]])
        .filter(([, value]) => value !== undefined)
    );
    updateProductMutation({ id: id as Id<"products">, ...updates });
  };

  const deleteProduct = (id: string) => {
    removeProduct({ id: id as Id<"products"> });
  };

  // --- Deep merge utility for nested objects ---
  const deepMerge = (target: any, source: any): any => {
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  };

  // --- Site Content Actions ---
  const updateSiteContentAction = (section: keyof SiteContent, data: Partial<SiteContent[keyof SiteContent]>) => {
    if (section === 'customPages') return; // Handled separately

    const currentValue = siteContent[section];
    // Use deep merge to properly handle nested objects like home.hero, home.categoryImages, etc.
    const updatedValue = deepMerge(currentValue, data);

    updateSiteContentMutation({ [section]: updatedValue } as any);
  };

  // --- Custom Page Actions ---
  const addCustomPage = (page: CustomPage) => {
    const { id, ...pageData } = page;
    createCustomPage(pageData);
  };

  const updateCustomPageAction = (id: string, pageData: Partial<CustomPage>) => {
    const { id: _, ...updates } = pageData as any;
    updateCustomPageMutation({ id: id as Id<"customPages">, ...updates });
  };

  const deleteCustomPageAction = (id: string) => {
    removeCustomPage({ id: id as Id<"customPages"> });
  };

  const getCustomPage = (slug: string) => {
    return customPages.find(p => p.slug === slug);
  };

  // --- Navigation & Collection Actions ---
  const updateNavigation = (navLinks: NavLink[]) => {
    updateSiteContentMutation({ navLinks });
  };

  const addCollection = (collection: CollectionConfig) => {
    const newCollections = [...siteContent.collections, collection];
    updateSiteContentMutation({ collections: newCollections });
  };

  const updateCollection = (id: string, collectionData: Partial<CollectionConfig>) => {
    const updatedCollections = siteContent.collections.map(c =>
      c.id === id ? { ...c, ...collectionData } : c
    );
    updateSiteContentMutation({ collections: updatedCollections });
  };

  const deleteCollection = (id: string) => {
    const filteredCollections = siteContent.collections.filter(c => c.id !== id);
    updateSiteContentMutation({ collections: filteredCollections });
  };

  return (
    <SiteContext.Provider value={{
      posts,
      products,
      siteContent,
      isLoading,
      isAuthenticated,
      isAuthLoading,
      signIn,
      logout,
      addPost,
      updatePost,
      deletePost,
      getPost,
      addProduct,
      updateProduct,
      deleteProduct,
      updateSiteContent: updateSiteContentAction,
      addCustomPage,
      updateCustomPage: updateCustomPageAction,
      deleteCustomPage: deleteCustomPageAction,
      getCustomPage,
      updateNavigation,
      addCollection,
      updateCollection,
      deleteCollection
    }}>
      {children}
    </SiteContext.Provider>
  );
};

export const useSite = () => {
  const context = useContext(SiteContext);
  if (context === undefined) {
    throw new Error('useSite must be used within a SiteProvider');
  }
  return context;
};

export const useBlog = useSite;
