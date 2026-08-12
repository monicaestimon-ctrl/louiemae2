import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireCjAdminIdentity } from "./cjAdminAccess";

// Public query - anyone can read site content
export const get = query({
    args: {},
    handler: async (ctx) => {
        const content = await ctx.db.query("siteContent").first();
        return content;
    },
});

// Clear siteContent to trigger re-seed with fresh defaults
export const clearForReseed = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (existing) {
            await ctx.db.delete(existing._id);
            return { success: true, message: "SiteContent cleared. Refresh page to re-seed." };
        }
        return { success: false, message: "No siteContent found to clear." };
    },
});

// One-time migration to fix decor category image
export const fixDecorImage = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (existing) {
            const updatedHome = {
                ...existing.home,
                categoryImages: {
                    ...(existing.home?.categoryImages || {}),
                    decor: "/images/brand/rustic-bench.png",
                },
            };
            await ctx.db.patch(existing._id, { home: updatedHome });
            return { success: true, message: "Decor image updated to rustic-bench.png" };
        }
        return { success: false, message: "No siteContent found" };
    },
});

// One-time migration to fix furniture category image
export const fixFurnitureImage = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (existing) {
            const updatedHome = {
                ...existing.home,
                categoryImages: {
                    ...(existing.home?.categoryImages || {}),
                    furniture: "/images/brand/hero-living-organic.png",
                },
            };
            await ctx.db.patch(existing._id, { home: updatedHome });
            return { success: true, message: "Furniture image updated to hero-living-organic.png" };
        }
        return { success: false, message: "No siteContent found" };
    },
});

// Protected mutation - require authentication
export const update = mutation({
    args: {
        navLinks: v.optional(v.array(v.any())),
        collections: v.optional(v.array(v.any())),
        home: v.optional(v.any()),
        story: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);

        const existing = await ctx.db.query("siteContent").first();

        const filteredUpdates = Object.fromEntries(
            Object.entries(args).filter(([_, v]) => v !== undefined)
        );

        if (existing) {
            await ctx.db.patch(existing._id, filteredUpdates);
            return existing._id;
        } else {
            // Create new document if none exists
            return await ctx.db.insert("siteContent", args as any);
        }
    },
});

// Seed initial site content - protected
export const seed = mutation({
    args: {
        navLinks: v.array(v.any()),
        collections: v.array(v.any()),
        home: v.any(),
        story: v.any(),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (existing) {
            // Already seeded
            return existing._id;
        }
        return await ctx.db.insert("siteContent", args);
    },
});

// Update hero image directly - protected
export const updateHeroImage = mutation({
    args: {
        imageUrl: v.string(),
    },
    handler: async (ctx, args) => {
        await requireCjAdminIdentity(ctx);

        const existing = await ctx.db.query("siteContent").first();
        if (existing) {
            const updatedHome = {
                ...existing.home,
                hero: {
                    ...(existing.home?.hero || {}),
                    image: args.imageUrl,
                },
            };
            await ctx.db.patch(existing._id, { home: updatedHome });
            return existing._id;
        }
        return null;
    },
});

// Migration to update menu structure - protected
// Call this once to update the navigation and collections with the new structure
export const migrateToNewMenuStructure = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        // New navigation structure with nested dropdowns
        const newNavLinks = [
            { label: 'Home', href: '#', children: [{ label: 'Our Story', href: '#story' }] },
            { label: 'Simply By Mae', href: '#', children: [{ label: 'Simply Mae', href: '#blog' }] },
            {
                label: 'Louie Kids & Co.',
                href: '#collection/kids',
                children: [
                    { label: 'Shop All', href: '#collection/kids' },
                    {
                        label: 'Girls',
                        href: '#collection/kids?cat=Girls',
                        children: [
                            { label: 'Shop All Girls', href: '#collection/kids?cat=Girls' },
                            { label: 'Dresses', href: '#collection/kids?cat=Girls Dresses' },
                            { label: 'Outfits & Sets', href: '#collection/kids?cat=Girls Outfits & Sets' },
                            { label: 'Rompers', href: '#collection/kids?cat=Girls Rompers' },
                            { label: 'Tops', href: '#collection/kids?cat=Girls Tops' },
                            { label: 'Layers', href: '#collection/kids?cat=Girls Layers' },
                            {
                                label: 'Bottoms',
                                href: '#collection/kids?cat=Girls Bottoms',
                                children: [
                                    { label: 'Leggings', href: '#collection/kids?cat=Girls Leggings' },
                                    { label: 'Shorts', href: '#collection/kids?cat=Girls Shorts' },
                                    { label: 'Pants', href: '#collection/kids?cat=Girls Pants' },
                                    { label: 'Skirts', href: '#collection/kids?cat=Girls Skirts' },
                                ]
                            },
                            { label: 'Footwear', href: '#collection/kids?cat=Girls Footwear' },
                        ]
                    },
                    {
                        label: 'Boys',
                        href: '#collection/kids?cat=Boys',
                        children: [
                            { label: 'Shop All Boys', href: '#collection/kids?cat=Boys' },
                            { label: 'Tops', href: '#collection/kids?cat=Boys Tops' },
                            {
                                label: 'Bottoms',
                                href: '#collection/kids?cat=Boys Bottoms',
                                children: [
                                    { label: 'Shorts', href: '#collection/kids?cat=Boys Shorts' },
                                    { label: 'Pants', href: '#collection/kids?cat=Boys Pants' },
                                    { label: 'Joggers', href: '#collection/kids?cat=Boys Joggers' },
                                ]
                            },
                            { label: 'Outfits & Sets', href: '#collection/kids?cat=Boys Outfits & Sets' },
                            { label: 'Layers', href: '#collection/kids?cat=Boys Layers' },
                            { label: 'Overalls', href: '#collection/kids?cat=Boys Overalls' },
                            { label: 'Footwear', href: '#collection/kids?cat=Boys Footwear' },
                        ]
                    },
                    { label: 'Toys', href: '#collection/kids?cat=Toys' },
                    {
                        label: 'Nursery Furniture',
                        href: '#collection/kids?cat=Nursery Furniture',
                        children: [
                            {
                                label: 'Furniture',
                                href: '#collection/kids?cat=Nursery Furniture',
                                children: [
                                    { label: 'Cribs & Bassinets', href: '#collection/kids?cat=Cribs & Bassinets' },
                                    { label: 'Dressers', href: '#collection/kids?cat=Nursery Dressers' },
                                    { label: 'Side Tables', href: '#collection/kids?cat=Nursery Side Tables' },
                                ]
                            },
                            {
                                label: 'Storage & Organization Solutions',
                                href: '#collection/kids?cat=Nursery Storage',
                                children: [
                                    { label: 'Storage Units', href: '#collection/kids?cat=Nursery Storage Units' },
                                    { label: 'Storage Benches', href: '#collection/kids?cat=Nursery Storage Benches' },
                                    { label: 'Storage Ottomans', href: '#collection/kids?cat=Nursery Storage Ottomans' },
                                    { label: 'Shelving & Wall Storage', href: '#collection/kids?cat=Nursery Shelving' },
                                ]
                            },
                            {
                                label: 'Decor & Styling',
                                href: '#collection/kids?cat=Nursery Decor',
                                children: [
                                    { label: 'Nursery Decor', href: '#collection/kids?cat=Nursery Decor' },
                                    { label: 'Nursery Themes', href: '#collection/kids?cat=Nursery Themes' },
                                ]
                            },
                        ]
                    },
                    {
                        label: 'Playroom Furniture',
                        href: '#collection/kids?cat=Playroom Furniture',
                        children: [
                            {
                                label: 'Furniture',
                                href: '#collection/kids?cat=Playroom Furniture',
                                children: [
                                    { label: 'Tables & Seating', href: '#collection/kids?cat=Playroom Tables & Seating' },
                                    { label: 'Soft Play & Cozy Lounge', href: '#collection/kids?cat=Playroom Soft Play' },
                                    { label: 'Art & Activity Furniture', href: '#collection/kids?cat=Playroom Art Furniture' },
                                    { label: 'Pretend & Imaginative Play', href: '#collection/kids?cat=Playroom Pretend Play' },
                                ]
                            },
                            {
                                label: 'Storage & Organization Solutions',
                                href: '#collection/kids?cat=Playroom Storage',
                                children: [
                                    { label: 'Toy Storage & Organization', href: '#collection/kids?cat=Toy Storage' },
                                    { label: 'Shelving & Wall Storage', href: '#collection/kids?cat=Playroom Shelving' },
                                ]
                            },
                        ]
                    },
                ]
            },
            {
                label: 'The Mae Collective',
                href: '#collection/fashion',
                children: [
                    { label: 'Shop All', href: '#collection/fashion' },
                    {
                        label: 'Dresses',
                        href: '#collection/fashion?cat=Dresses',
                        children: [
                            { label: 'Everyday Dresses', href: '#collection/fashion?cat=Everyday Dresses' },
                            { label: 'Formal Dresses', href: '#collection/fashion?cat=Formal Dresses' },
                        ]
                    },
                    {
                        label: 'Tops',
                        href: '#collection/fashion?cat=Tops',
                        children: [
                            { label: 'Blouses', href: '#collection/fashion?cat=Blouses' },
                            { label: 'Casual Tops', href: '#collection/fashion?cat=Casual Tops' },
                        ]
                    },
                    {
                        label: 'Bottoms',
                        href: '#collection/fashion?cat=Bottoms',
                        children: [
                            { label: 'Pants', href: '#collection/fashion?cat=Pants' },
                            { label: 'Skirts', href: '#collection/fashion?cat=Skirts' },
                            { label: 'Denim', href: '#collection/fashion?cat=Denim' },
                        ]
                    },
                    {
                        label: 'Blazers & Layers',
                        href: '#collection/fashion?cat=Blazers & Layers',
                        children: [
                            { label: 'Blazers', href: '#collection/fashion?cat=Blazers' },
                            { label: 'Layers', href: '#collection/fashion?cat=Layers' },
                        ]
                    },
                    {
                        label: 'Active & Lounge',
                        href: '#collection/fashion?cat=Active & Lounge',
                        children: [
                            { label: 'Active', href: '#collection/fashion?cat=Active' },
                            { label: 'Lounge', href: '#collection/fashion?cat=Lounge' },
                        ]
                    },
                    {
                        label: 'Outfits & Sets',
                        href: '#collection/fashion?cat=Outfits & Sets',
                        children: [
                            { label: 'Formal Outfits', href: '#collection/fashion?cat=Formal Outfits' },
                            { label: 'Casual Sets', href: '#collection/fashion?cat=Casual Sets' },
                        ]
                    },
                    { label: 'Vacation Edit', href: '#collection/fashion?cat=Vacation Edit' },
                ]
            },
            {
                label: 'Furniture',
                href: '#collection/furniture',
                children: [
                    { label: 'Shop All', href: '#collection/furniture' },
                    { label: 'Accent Chairs', href: '#collection/furniture?cat=Accent Chairs' },
                    { label: 'Barstools', href: '#collection/furniture?cat=Barstools' },
                    { label: 'Counterstools', href: '#collection/furniture?cat=Counterstools' },
                    { label: 'Side Storage Cabinets', href: '#collection/furniture?cat=Side Storage Cabinets' },
                    { label: 'Dining Chairs', href: '#collection/furniture?cat=Dining Chairs' },
                    { label: 'Dining Tables', href: '#collection/furniture?cat=Dining Tables' },
                    { label: 'Entryway Tables', href: '#collection/furniture?cat=Entryway Tables' },
                    { label: 'Nightstands', href: '#collection/furniture?cat=Nightstands' },
                    {
                        label: 'Nursery Furniture',
                        href: '#collection/furniture?cat=Nursery Furniture',
                        children: [
                            {
                                label: 'Furniture',
                                href: '#collection/furniture?cat=Nursery Furniture',
                                children: [
                                    { label: 'Cribs & Bassinets', href: '#collection/furniture?cat=Cribs & Bassinets' },
                                    { label: 'Dressers', href: '#collection/furniture?cat=Nursery Dressers' },
                                    { label: 'Side Tables', href: '#collection/furniture?cat=Nursery Side Tables' },
                                ]
                            },
                            {
                                label: 'Storage & Organization Solutions',
                                href: '#collection/furniture?cat=Nursery Storage',
                                children: [
                                    { label: 'Storage Units', href: '#collection/furniture?cat=Nursery Storage Units' },
                                    { label: 'Storage Benches', href: '#collection/furniture?cat=Nursery Storage Benches' },
                                    { label: 'Storage Ottomans', href: '#collection/furniture?cat=Nursery Storage Ottomans' },
                                    { label: 'Shelving & Wall Storage', href: '#collection/furniture?cat=Nursery Shelving' },
                                ]
                            },
                            {
                                label: 'Decor & Styling',
                                href: '#collection/furniture?cat=Nursery Decor',
                                children: [
                                    { label: 'Nursery Decor', href: '#collection/furniture?cat=Nursery Decor' },
                                    { label: 'Nursery Themes', href: '#collection/furniture?cat=Nursery Themes' },
                                ]
                            },
                        ]
                    },
                    {
                        label: 'Playroom Furniture',
                        href: '#collection/furniture?cat=Playroom Furniture',
                        children: [
                            {
                                label: 'Furniture',
                                href: '#collection/furniture?cat=Playroom Furniture',
                                children: [
                                    { label: 'Tables & Seating', href: '#collection/furniture?cat=Playroom Tables & Seating' },
                                    { label: 'Soft Play & Cozy Lounge', href: '#collection/furniture?cat=Playroom Soft Play' },
                                    { label: 'Art & Activity Furniture', href: '#collection/furniture?cat=Playroom Art Furniture' },
                                    { label: 'Pretend & Imaginative Play', href: '#collection/furniture?cat=Playroom Pretend Play' },
                                ]
                            },
                            {
                                label: 'Storage & Organization Solutions',
                                href: '#collection/furniture?cat=Playroom Storage',
                                children: [
                                    { label: 'Toy Storage & Organization', href: '#collection/furniture?cat=Toy Storage' },
                                    { label: 'Shelving & Wall Storage', href: '#collection/furniture?cat=Playroom Shelving' },
                                ]
                            },
                        ]
                    },
                ]
            },
            {
                label: 'Home Decor',
                href: '#collection/decor',
                children: [
                    { label: 'Shop All', href: '#collection/decor' },
                    { label: 'Decor Items', href: '#collection/decor?cat=Decor Items' },
                    { label: 'Table Lamps', href: '#collection/decor?cat=Table Lamps' },
                    { label: 'Vases', href: '#collection/decor?cat=Vases' },
                    { label: 'Floor Lamps', href: '#collection/decor?cat=Floor Lamps' },
                    { label: 'Rugs', href: '#collection/decor?cat=Rugs' },
                    { label: 'Accent Chairs', href: '#collection/furniture?cat=Accent Chairs' },
                ]
            },
        ];

        // New collections with all subcategories
        const newCollections = [
            {
                id: 'furniture',
                title: 'Furniture',
                subtitle: 'Curated pieces for a timeless home',
                heroImage: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=2000&auto=format&fit=crop',
                subcategories: [
                    { id: 'accent-chairs', title: 'Accent Chairs', image: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?q=80&w=800', caption: 'Sit & Stay Awhile' },
                    { id: 'barstools', title: 'Barstools', image: 'https://images.unsplash.com/photo-1594226372073-672ce3467332?q=80&w=800', caption: 'Kitchen Comforts' },
                    { id: 'counterstools', title: 'Counterstools', image: 'https://images.unsplash.com/photo-1594226372073-672ce3467332?q=80&w=800', caption: 'Counter Height Seating' },
                    { id: 'side-storage-cabinets', title: 'Side Storage Cabinets', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', caption: 'Functional Beauty' },
                    { id: 'dining-chairs', title: 'Dining Chairs', image: 'https://images.unsplash.com/photo-1615529182904-14819c35db37?q=80&w=800', caption: 'Gather in Style' },
                    { id: 'dining-tables', title: 'Dining Tables', image: 'https://images.unsplash.com/photo-1615529182904-14819c35db37?q=80&w=800', caption: 'Gather Together' },
                    { id: 'entryway-tables', title: 'Entryway Tables', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', caption: 'First Impressions' },
                    { id: 'nightstands', title: 'Nightstands', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', caption: 'Bedside Essentials' },
                    { id: 'nursery-furniture', title: 'Nursery Furniture', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'For Little Ones' },
                    { id: 'playroom-furniture', title: 'Playroom Furniture', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Create & Explore' },
                ]
            },
            {
                id: 'decor',
                title: 'Home Decor',
                subtitle: 'The details that tell your story',
                heroImage: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=2000&auto=format&fit=crop',
                subcategories: [
                    // Main Parent Category - triggers swimlane view
                    { id: 'home-decor', title: 'Home Decor', image: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=800', caption: 'Curated Accents', isMainCategory: true },
                    // Child Categories - displayed as swimlanes with product cards
                    { id: 'decor-items', title: 'Decor Items', image: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=800', caption: 'Curated Objects', parentCategory: 'Home Decor' },
                    { id: 'table-lamps', title: 'Table Lamps', image: 'https://images.unsplash.com/photo-1513506003011-3b03c8b063ca?q=80&w=800', caption: 'Ambient Light', parentCategory: 'Home Decor' },
                    { id: 'vases', title: 'Vases', image: 'https://images.unsplash.com/photo-1612196808214-b7e239e5f6b7?q=80&w=800', caption: 'Ceramic & Glass', parentCategory: 'Home Decor' },
                    { id: 'floor-lamps', title: 'Floor Lamps', image: 'https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?q=80&w=800', caption: 'Corner Brightening', parentCategory: 'Home Decor' },
                    { id: 'rugs', title: 'Rugs', image: 'https://images.unsplash.com/photo-1599694239849-012b68328761?q=80&w=800', caption: 'Grounding Textures', parentCategory: 'Home Decor' },
                    { id: 'accent-chairs', title: 'Accent Chairs', image: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?q=80&w=800', caption: 'Statement Seating', parentCategory: 'Home Decor' },
                ]
            },
            {
                id: 'fashion',
                title: 'The Mae Collective',
                subtitle: 'Effortless style for the modern woman',
                heroImage: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=2000&auto=format&fit=crop',
                subcategories: [
                    { id: 'dresses', title: 'Dresses', image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?q=80&w=800', caption: 'Effortless Elegance' },
                    { id: 'everyday-dresses', title: 'Everyday Dresses', image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?q=80&w=800', caption: 'Daily Style' },
                    { id: 'formal-dresses', title: 'Formal Dresses', image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?q=80&w=800', caption: 'Special Occasions' },
                    { id: 'tops', title: 'Tops', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Everyday Essentials' },
                    { id: 'blouses', title: 'Blouses', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Refined Style' },
                    { id: 'casual-tops', title: 'Casual Tops', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Easy Everyday' },
                    { id: 'bottoms', title: 'Bottoms', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800', caption: 'Perfect Fit' },
                    { id: 'pants', title: 'Pants', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800', caption: 'Tailored Comfort' },
                    { id: 'skirts', title: 'Skirts', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800', caption: 'Feminine Flow' },
                    { id: 'denim', title: 'Denim', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800', caption: 'Classic & Versatile' },
                    { id: 'blazers-layers', title: 'Blazers & Layers', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Polished Layers' },
                    { id: 'blazers', title: 'Blazers', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Power Pieces' },
                    { id: 'layers', title: 'Layers', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Seasonal Essentials' },
                    { id: 'active-lounge', title: 'Active & Lounge', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Comfy Chic' },
                    { id: 'active', title: 'Active', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Move Freely' },
                    { id: 'lounge', title: 'Lounge', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Relaxed Living' },
                    { id: 'outfits-sets', title: 'Outfits & Sets', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Coordinated Style' },
                    { id: 'formal-outfits', title: 'Formal Outfits', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Elevated Looks' },
                    { id: 'casual-sets', title: 'Casual Sets', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Effortless Matching' },
                    { id: 'vacation-edit', title: 'Vacation Edit', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Travel in Style' },
                ]
            },
            {
                id: 'kids',
                title: 'Louie Kids & Co.',
                subtitle: 'Heirloom quality for little ones',
                heroImage: 'https://images.unsplash.com/photo-1596870230751-ebdfce98ec42?q=80&w=2000&auto=format&fit=crop',
                subcategories: [
                    // Girls Categories
                    { id: 'girls', title: 'Girls', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Little Ladies' },
                    { id: 'girls-dresses', title: 'Girls Dresses', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Pretty Dresses' },
                    { id: 'girls-outfits-sets', title: 'Girls Outfits & Sets', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Coordinated Looks' },
                    { id: 'girls-rompers', title: 'Girls Rompers', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Playful Style' },
                    { id: 'girls-tops', title: 'Girls Tops', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Cute Tops' },
                    { id: 'girls-layers', title: 'Girls Layers', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Sweet Layers' },
                    { id: 'girls-bottoms', title: 'Girls Bottoms', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Comfy Bottoms' },
                    { id: 'girls-leggings', title: 'Girls Leggings', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Stretchy Fun' },
                    { id: 'girls-shorts', title: 'Girls Shorts', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Summer Ready' },
                    { id: 'girls-pants', title: 'Girls Pants', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Everyday Pants' },
                    { id: 'girls-skirts', title: 'Girls Skirts', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Twirly Skirts' },
                    { id: 'girls-footwear', title: 'Girls Footwear', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Little Steps' },
                    // Boys Categories
                    { id: 'boys', title: 'Boys', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Little Gentlemen' },
                    { id: 'boys-tops', title: 'Boys Tops', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Cool Tops' },
                    { id: 'boys-bottoms', title: 'Boys Bottoms', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Comfy Bottoms' },
                    { id: 'boys-shorts', title: 'Boys Shorts', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Active Shorts' },
                    { id: 'boys-pants', title: 'Boys Pants', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Sturdy Pants' },
                    { id: 'boys-joggers', title: 'Boys Joggers', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Comfy Joggers' },
                    { id: 'boys-outfits-sets', title: 'Boys Outfits & Sets', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Matching Sets' },
                    { id: 'boys-layers', title: 'Boys Layers', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Layered Up' },
                    { id: 'boys-overalls', title: 'Boys Overalls', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Classic Overalls' },
                    { id: 'boys-footwear', title: 'Boys Footwear', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Little Steps' },
                    // Other Categories
                    { id: 'toys', title: 'Toys', image: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?q=80&w=800', caption: 'Play & Learn' },
                    // Nursery Furniture Categories
                    { id: 'nursery-furniture', title: 'Nursery Furniture', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'The Dreamiest Space' },
                    { id: 'cribs-sleep', title: 'Cribs & Sleep Solutions', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Sweet Dreams' },
                    { id: 'dressers-changing', title: 'Dressers & Changing Tables', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Organized Nursery' },
                    { id: 'nursery-side-tables', title: 'Nursery Side Tables', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Bedside Essentials' },
                    { id: 'nursery-storage', title: 'Nursery Storage', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Organized Space' },
                    { id: 'nursery-decor', title: 'Nursery Decor', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Sweet Details' },
                    { id: 'nursery-themes', title: 'Nursery Themes', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Theme Inspiration' },
                    // Playroom Furniture Categories
                    { id: 'playroom-furniture', title: 'Playroom Furniture', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Create & Explore' },
                    { id: 'playroom-tables-seating', title: 'Playroom Tables & Seating', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Activity Stations' },
                    { id: 'playroom-soft-play', title: 'Playroom Soft Play', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Cozy Corners' },
                    { id: 'playroom-art-furniture', title: 'Playroom Art Furniture', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Creative Spaces' },
                    { id: 'playroom-pretend-play', title: 'Playroom Pretend Play', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Imaginary Worlds' },
                    { id: 'toy-storage', title: 'Toy Storage', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Organized Play' },
                    { id: 'playroom-shelving', title: 'Playroom Shelving', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Wall Storage' },
                ]
            }
        ];

        // Update the database
        const existing = await ctx.db.query("siteContent").first();
        if (existing) {
            await ctx.db.patch(existing._id, {
                navLinks: newNavLinks,
                collections: newCollections,
            });
            return { success: true, message: "Menu structure updated successfully" };
        } else {
            return { success: false, message: "No siteContent found to update" };
        }
    },
});
// Migration to update ALL collections (Fashion, Furniture, Decor, Kids) with hierarchy flags
export const migrateAllCollectionsHierarchy = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        // --- 1. Fashion Collection ---
        const fashionCollection = {
            id: 'fashion',
            title: 'The Mae Collective',
            subtitle: 'Effortless style for the modern woman',
            heroImage: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=2000&auto=format&fit=crop',
            subcategories: [
                // Main Categories
                { id: 'dresses-main', title: 'Dresses', image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?q=80&w=800', caption: 'Effortless Elegance', isMainCategory: true },
                { id: 'tops-main', title: 'Tops', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Everyday Essentials', isMainCategory: true },
                { id: 'bottoms-main', title: 'Bottoms', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800', caption: 'Perfect Fit', isMainCategory: true },
                { id: 'blazers-layers-main', title: 'Blazers & Layers', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Polished Layers', isMainCategory: true },
                { id: 'active-lounge-main', title: 'Active & Lounge', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Comfy Chic', isMainCategory: true },
                { id: 'outfits-sets-main', title: 'Outfits & Sets', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Coordinated Style', isMainCategory: true },

                // Subcategories
                { id: 'everyday-dresses', title: 'Everyday Dresses', image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?q=80&w=800', caption: 'Daily Style', parentCategory: 'Dresses' },
                { id: 'formal-dresses', title: 'Formal Dresses', image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?q=80&w=800', caption: 'Special Occasions', parentCategory: 'Dresses' },

                { id: 'blouses', title: 'Blouses', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Refined Style', parentCategory: 'Tops' },
                { id: 'casual-tops', title: 'Casual Tops', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Easy Everyday', parentCategory: 'Tops' },

                { id: 'pants', title: 'Pants', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800', caption: 'Tailored Comfort', parentCategory: 'Bottoms' },
                { id: 'skirts', title: 'Skirts', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800', caption: 'Feminine Flow', parentCategory: 'Bottoms' },
                { id: 'denim', title: 'Denim', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=800', caption: 'Classic & Versatile', parentCategory: 'Bottoms' },

                { id: 'blazers', title: 'Blazers', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Power Pieces', parentCategory: 'Blazers & Layers' },
                { id: 'layers', title: 'Layers', image: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?q=80&w=800', caption: 'Seasonal Essentials', parentCategory: 'Blazers & Layers' },

                { id: 'active', title: 'Active', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Move Freely', parentCategory: 'Active & Lounge' },
                { id: 'lounge', title: 'Lounge', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Relaxed Living', parentCategory: 'Active & Lounge' },

                { id: 'formal-outfits', title: 'Formal Outfits', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Elevated Looks', parentCategory: 'Outfits & Sets' },
                { id: 'casual-sets', title: 'Casual Sets', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Effortless Matching', parentCategory: 'Outfits & Sets' },

                // Standalone / Special
                { id: 'vacation-edit', title: 'Vacation Edit', image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800', caption: 'Travel in Style', isMainCategory: true },
            ]
        };

        // --- 2. Furniture Collection (FLAT - all categories visible) ---
        const furnitureCollection = {
            id: 'furniture',
            title: 'Furniture',
            subtitle: 'Curated pieces for a timeless home',
            heroImage: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=2000&auto=format&fit=crop',
            subcategories: [
                { id: 'accent-chairs', title: 'Accent Chairs', image: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?q=80&w=800', caption: 'Statement Pieces' },
                { id: 'barstools', title: 'Barstools', image: 'https://images.unsplash.com/photo-1594226372073-672ce3467332?q=80&w=800', caption: 'Kitchen Seating' },
                { id: 'counterstools', title: 'Counterstools', image: 'https://images.unsplash.com/photo-1594226372073-672ce3467332?q=80&w=800', caption: 'Counter Height' },
                { id: 'side-storage-cabinets', title: 'Side Storage Cabinets', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', caption: 'Stylish Storage' },
                { id: 'dining-chairs', title: 'Dining Chairs', image: 'https://images.unsplash.com/photo-1615529182904-14819c35db37?q=80&w=800', caption: 'Dining Comfort' },
                { id: 'dining-tables', title: 'Dining Tables', image: 'https://images.unsplash.com/photo-1615529182904-14819c35db37?q=80&w=800', caption: 'Gather Together' },
                { id: 'entryway-tables', title: 'Entryway Tables', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', caption: 'First Impressions' },
                { id: 'nightstands', title: 'Nightstands', image: 'https://images.unsplash.com/photo-1595428774223-ef52624120d2?q=80&w=800', caption: 'Bedside Essentials' },
                { id: 'nursery-furniture', title: 'Nursery Furniture', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'For Little Ones', redirect: '#collection/kids?cat=Nursery Furniture' },
                { id: 'playroom-furniture', title: 'Playroom Furniture', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Create & Explore', redirect: '#collection/kids?cat=Playroom Furniture' },
            ]
        };

        // --- 3. Decor Collection - Swimlane Layout (like Kids) ---
        const decorCollection = {
            id: 'decor',
            title: 'Home Decor',
            subtitle: 'The details that tell your story',
            heroImage: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=2000&auto=format&fit=crop',
            subcategories: [
                // Main Parent Category - triggers swimlane view when selected
                { id: 'home-decor', title: 'Home Decor', image: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=800', caption: 'Curated Accents', isMainCategory: true },
                // Child Categories - displayed as swimlanes with product cards
                { id: 'decor-items', title: 'Decor Items', image: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=800', caption: 'Curated Objects', parentCategory: 'Home Decor' },
                { id: 'table-lamps', title: 'Table Lamps', image: 'https://images.unsplash.com/photo-1513506003011-3b03c8b063ca?q=80&w=800', caption: 'Ambient Light', parentCategory: 'Home Decor' },
                { id: 'vases', title: 'Vases', image: 'https://images.unsplash.com/photo-1612196808214-b7e239e5f6b7?q=80&w=800', caption: 'Ceramic & Glass', parentCategory: 'Home Decor' },
                { id: 'floor-lamps', title: 'Floor Lamps', image: 'https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?q=80&w=800', caption: 'Corner Brightening', parentCategory: 'Home Decor' },
                { id: 'rugs', title: 'Rugs', image: 'https://images.unsplash.com/photo-1599694239849-012b68328761?q=80&w=800', caption: 'Grounding Textures', parentCategory: 'Home Decor' },
                { id: 'accent-chairs', title: 'Accent Chairs', image: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?q=80&w=800', caption: 'Statement Seating', parentCategory: 'Home Decor' },
            ]
        };

        // --- 4. Kids Collection (Keep existing) ---
        // Reuse the Kids definition from earlier or just update everything safely
        const kidsCollection = {
            id: 'kids',
            title: 'Louie Kids & Co.',
            subtitle: 'Heirloom quality for little ones',
            heroImage: 'https://images.unsplash.com/photo-1596870230751-ebdfce98ec42?q=80&w=2000&auto=format&fit=crop',
            subcategories: [
                // Main Categories (shown on collection landing)
                { id: 'girls', title: 'Girls', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Little Ladies', isMainCategory: true },
                { id: 'boys', title: 'Boys', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Little Gentlemen', isMainCategory: true },
                { id: 'toys', title: 'Toys', image: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?q=80&w=800', caption: 'Play & Learn', isMainCategory: true },
                { id: 'nursery-furniture', title: 'Nursery Furniture', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'The Dreamiest Space', isMainCategory: true },
                { id: 'playroom-furniture', title: 'Playroom Furniture', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Create & Explore', isMainCategory: true },

                // Girls Subcategories
                { id: 'girls-dresses', title: 'Girls Dresses', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Pretty Dresses', parentCategory: 'Girls' },
                { id: 'girls-outfits-sets', title: 'Girls Outfits & Sets', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Coordinated Looks', parentCategory: 'Girls' },
                { id: 'girls-rompers', title: 'Girls Rompers', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Playful Style', parentCategory: 'Girls' },
                { id: 'girls-tops', title: 'Girls Tops', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Cute Tops', parentCategory: 'Girls' },
                { id: 'girls-layers', title: 'Girls Layers', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Sweet Layers', parentCategory: 'Girls' },
                { id: 'girls-bottoms', title: 'Girls Bottoms', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Comfy Bottoms', parentCategory: 'Girls' },
                { id: 'girls-leggings', title: 'Girls Leggings', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Stretchy Fun', parentCategory: 'Girls' },
                { id: 'girls-shorts', title: 'Girls Shorts', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Summer Ready', parentCategory: 'Girls' },
                { id: 'girls-pants', title: 'Girls Pants', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Everyday Pants', parentCategory: 'Girls' },
                { id: 'girls-skirts', title: 'Girls Skirts', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Twirly Skirts', parentCategory: 'Girls' },
                { id: 'girls-footwear', title: 'Girls Footwear', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Little Steps', parentCategory: 'Girls' },

                // Boys Subcategories
                { id: 'boys-tops', title: 'Boys Tops', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Cool Tops', parentCategory: 'Boys' },
                { id: 'boys-bottoms', title: 'Boys Bottoms', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Comfy Bottoms', parentCategory: 'Boys' },
                { id: 'boys-shorts', title: 'Boys Shorts', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Active Shorts', parentCategory: 'Boys' },
                { id: 'boys-pants', title: 'Boys Pants', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Sturdy Pants', parentCategory: 'Boys' },
                { id: 'boys-joggers', title: 'Boys Joggers', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Comfy Joggers', parentCategory: 'Boys' },
                { id: 'boys-outfits-sets', title: 'Boys Outfits & Sets', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Matching Sets', parentCategory: 'Boys' },
                { id: 'boys-layers', title: 'Boys Layers', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Layered Up', parentCategory: 'Boys' },
                { id: 'boys-overalls', title: 'Boys Overalls', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Classic Overalls', parentCategory: 'Boys' },
                { id: 'boys-footwear', title: 'Boys Footwear', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Little Steps', parentCategory: 'Boys' },

                // Nursery Furniture Subcategories
                { id: 'cribs-sleep', title: 'Cribs & Sleep Solutions', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Sweet Dreams', parentCategory: 'Nursery Furniture' },
                { id: 'dressers-changing', title: 'Dressers & Changing Tables', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Organized Nursery', parentCategory: 'Nursery Furniture' },
                { id: 'nursery-side-tables', title: 'Nursery Side Tables', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Bedside Essentials', parentCategory: 'Nursery Furniture' },
                { id: 'nursery-storage', title: 'Nursery Storage', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Organized Space', parentCategory: 'Nursery Furniture' },
                { id: 'nursery-decor', title: 'Nursery Decor', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Sweet Details', parentCategory: 'Nursery Furniture' },
                { id: 'nursery-themes', title: 'Nursery Themes', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Theme Inspiration', parentCategory: 'Nursery Furniture' },

                // Playroom Furniture Subcategories
                { id: 'playroom-tables-seating', title: 'Playroom Tables & Seating', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Activity Stations', parentCategory: 'Playroom Furniture' },
                { id: 'playroom-soft-play', title: 'Playroom Soft Play', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Cozy Corners', parentCategory: 'Playroom Furniture' },
                { id: 'playroom-art-furniture', title: 'Playroom Art Furniture', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Creative Spaces', parentCategory: 'Playroom Furniture' },
                { id: 'playroom-pretend-play', title: 'Playroom Pretend Play', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Imaginary Worlds', parentCategory: 'Playroom Furniture' },
                { id: 'toy-storage', title: 'Toy Storage', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Organized Play', parentCategory: 'Playroom Furniture' },
                { id: 'playroom-shelving', title: 'Playroom Shelving', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Wall Storage', parentCategory: 'Playroom Furniture' },
            ]
        };

        // Get existing site content
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) {
            return { success: false, message: "No siteContent found to update" };
        }

        // Update the database with NEW collections
        await ctx.db.patch(existing._id, {
            collections: [furnitureCollection, decorCollection, fashionCollection, kidsCollection],
        });

        return { success: true, message: "Comprehensive hierarchical migration complete for ALL collections" };
    },
});

// One-time fix for Home Decor collection - Premium Grid Layout like Kids
export const fixHomeDecorCollection = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) {
            return { success: false, message: "No siteContent found" };
        }

        // Get current collections
        const collections = existing.collections || [];

        // Create updated decor collection with MULTIPLE MAIN CATEGORIES for premium grid
        // This matches the Louie Kids & Co. layout with 5 category cards
        const updatedDecorCollection = {
            id: 'decor',
            title: 'Home Decor',
            subtitle: 'The details that tell your story',
            heroImage: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=2000&auto=format&fit=crop',
            subcategories: [
                // Main Categories - displayed in premium grid (like Kids)
                { id: 'decor-items', title: 'Decor Items', image: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=800', caption: 'Curated Objects', isMainCategory: true },
                { id: 'table-lamps', title: 'Table Lamps', image: 'https://images.unsplash.com/photo-1513506003011-3b03c8b063ca?q=80&w=800', caption: 'Ambient Light', isMainCategory: true },
                { id: 'vases', title: 'Vases', image: 'https://images.unsplash.com/photo-1612196808214-b7e239e5f6b7?q=80&w=800', caption: 'Ceramic & Glass', isMainCategory: true },
                { id: 'floor-lamps', title: 'Floor Lamps', image: 'https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?q=80&w=800', caption: 'Corner Brightening', isMainCategory: true },
                { id: 'rugs', title: 'Rugs', image: 'https://images.unsplash.com/photo-1599694239849-012b68328761?q=80&w=800', caption: 'Grounding Textures', isMainCategory: true },
            ]
        };

        // Replace decor collection in the array
        const updatedCollections = collections.map((c: any) =>
            c.id === 'decor' ? updatedDecorCollection : c
        );

        await ctx.db.patch(existing._id, { collections: updatedCollections });

        return { success: true, message: "Home Decor collection updated with premium grid layout" };
    },
});

export const fixKidsCollection = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) {
            return { success: false, message: "No siteContent found" };
        }

        const collections = existing.collections || [];

        // Correct Kids Collection Structure
        const updatedKidsCollection = {
            id: 'kids',
            title: 'Louie Kids & Co.',
            subtitle: 'Heirloom quality for little ones',
            heroImage: 'https://images.unsplash.com/photo-1596870230751-ebdfce98ec42?q=80&w=2000&auto=format&fit=crop',
            subcategories: [
                // Main Categories (shown on collection landing)
                { id: 'girls', title: 'Girls', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Little Ladies', isMainCategory: true },
                { id: 'boys', title: 'Boys', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Little Gentlemen', isMainCategory: true },
                { id: 'toys', title: 'Toys', image: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?q=80&w=800', caption: 'Play & Learn', isMainCategory: true },
                { id: 'nursery-furniture', title: 'Nursery Furniture', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'The Dreamiest Space', isMainCategory: true },
                { id: 'playroom-furniture', title: 'Playroom Furniture', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Create & Explore', isMainCategory: true },

                // Girls Subcategories (kept flat for now mostly, but with parentCategory)
                { id: 'girls-dresses', title: 'Girls Dresses', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Pretty Dresses', parentCategory: 'Girls' },
                { id: 'girls-outfits-sets', title: 'Girls Outfits & Sets', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Coordinated Looks', parentCategory: 'Girls' },
                { id: 'girls-rompers', title: 'Girls Rompers', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Playful Style', parentCategory: 'Girls' },
                { id: 'girls-tops', title: 'Girls Tops', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Cute Tops', parentCategory: 'Girls' },
                { id: 'girls-layers', title: 'Girls Layers', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Sweet Layers', parentCategory: 'Girls' },
                { id: 'girls-bottoms', title: 'Girls Bottoms', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Comfy Bottoms', parentCategory: 'Girls' },
                { id: 'girls-footwear', title: 'Girls Footwear', image: 'https://images.unsplash.com/photo-1519238263496-6362d74c1123?q=80&w=800', caption: 'Little Steps', parentCategory: 'Girls' },

                // Boys Subcategories
                { id: 'boys-tops', title: 'Boys Tops', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Cool Tops', parentCategory: 'Boys' },
                { id: 'boys-bottoms', title: 'Boys Bottoms', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Comfy Bottoms', parentCategory: 'Boys' },
                { id: 'boys-outfits-sets', title: 'Boys Outfits & Sets', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Matching Sets', parentCategory: 'Boys' },
                { id: 'boys-footwear', title: 'Boys Footwear', image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?q=80&w=800', caption: 'Little Steps', parentCategory: 'Boys' },

                // Nursery Subcategories
                { id: 'cribs-sleep', title: 'Cribs & Sleep Solutions', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Sweet Dreams', parentCategory: 'Nursery Furniture' },
                { id: 'dressers-changing', title: 'Dressers & Changing Tables', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Organized Nursery', parentCategory: 'Nursery Furniture' },
                { id: 'nursery-storage', title: 'Nursery Storage', image: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=800', caption: 'Organized Space', parentCategory: 'Nursery Furniture' },

                // Playroom Subcategories
                { id: 'playroom-tables-seating', title: 'Playroom Tables & Seating', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Activity Stations', parentCategory: 'Playroom Furniture' },
                { id: 'playroom-storage', title: 'Toy Storage', image: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=800', caption: 'Organized Play', parentCategory: 'Playroom Furniture' },
            ]
        };

        // Replace kids collection
        const updatedCollections = collections.map((c: any) =>
            c.id === 'kids' ? updatedKidsCollection : c
        );

        await ctx.db.patch(existing._id, { collections: updatedCollections });

        return { success: true, message: "Kids collection fixed with proper main category flags" };
    }
});

// One-time migration to update category card images with brand assets
export const updateCategoryImages = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) {
            return { success: false, message: "No siteContent found" };
        }

        // 1. Update homepage categoryImages.kids
        const updatedHome = {
            ...existing.home,
            categoryImages: {
                ...(existing.home?.categoryImages || {}),
                kids: "/images/brand/kids-category.png",
            },
        };

        // 2. Update kids collection subcategory images (Boys, Nursery, Toys)
        const imageMap: Record<string, string> = {
            'boys': '/images/brand/boys-category.png',
            'nursery-furniture': '/images/brand/nursery-category.png',
            'toys': '/images/brand/toys-category.png',
        };

        const collections = (existing.collections || []).map((collection: any) => {
            if (collection.id !== 'kids') return collection;
            return {
                ...collection,
                subcategories: (collection.subcategories || []).map((sub: any) => {
                    if (imageMap[sub.id]) {
                        return { ...sub, image: imageMap[sub.id] };
                    }
                    return sub;
                }),
            };
        });

        await ctx.db.patch(existing._id, { home: updatedHome, collections });

        return { success: true, message: "Category images updated: Boys, Nursery Furn., Toys, and Kids homepage card" };
    },
});

// One-time migration to revert hero and update brand image
export const fixHeroImage = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (existing) {
            const updatedHome = {
                ...existing.home,
                hero: {
                    ...(existing.home?.hero || {}),
                    image: "/lm3.jpg",
                },
                brand: {
                    ...(existing.home?.brand || {}),
                    image: "/images/brand/hero-dining-wide.png",
                },
            };
            await ctx.db.patch(existing._id, { home: updatedHome });
            return { success: true, message: "Hero reverted to /lm3.jpg, brand image updated to hero-living-organic.png" };
        }
        return { success: false, message: "No siteContent found" };
    },
});

// One-time migration to update Girls category image
export const updateGirlsImage = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const collections = (existing.collections || []).map((collection: any) => {
            if (collection.id !== 'kids') return collection;
            return {
                ...collection,
                subcategories: (collection.subcategories || []).map((sub: any) => {
                    if (sub.id === 'girls') {
                        return { ...sub, image: '/images/brand/girls-dress.png' };
                    }
                    return sub;
                }),
            };
        });

        await ctx.db.patch(existing._id, { collections });
        return { success: true, message: "Girls category image updated to girls-dress.png" };
    },
});

// One-time migration to update Playroom category image
export const updatePlayroomImage = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const collections = (existing.collections || []).map((collection: any) => {
            if (collection.id !== 'kids') return collection;
            return {
                ...collection,
                subcategories: (collection.subcategories || []).map((sub: any) => {
                    if (sub.id === 'playroom-furniture') {
                        return { ...sub, image: '/images/brand/playroom-scene-v2.png' };
                    }
                    return sub;
                }),
            };
        });

        await ctx.db.patch(existing._id, { collections });
        return { success: true, message: "Playroom category image updated to playroom-scene-v2.png" };
    },
});

// One-time migration to update Blog, Tops, and Bottoms category images
export const updateBlogTopsBottomsImages = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        // 1. Update homepage categoryImages.journal
        const home = {
            ...(existing.home || {}),
            categoryImages: {
                ...(existing.home?.categoryImages || {}),
                journal: '/images/brand/blog-main-v2.png',
            },
        };

        // 2. Update fashion collection subcategories (tops-main, bottoms-main)
        const collections = (existing.collections || []).map((collection: any) => {
            if (collection.id !== 'fashion') return collection;
            return {
                ...collection,
                subcategories: (collection.subcategories || []).map((sub: any) => {
                    if (sub.id === 'tops-main') {
                        return { ...sub, image: '/images/brand/mae-shirt.png' };
                    }
                    if (sub.id === 'bottoms-main') {
                        return { ...sub, image: '/images/brand/mae-bottoms.png' };
                    }
                    return sub;
                }),
            };
        });

        await ctx.db.patch(existing._id, { home, collections });
        return { success: true, message: "Updated blog, tops, and bottoms category images" };
    },
});

// One-time migration to update Dresses, Sets, and Mae Collective category images
export const updateDressesSetsAndFashionImages = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        // 1. Update homepage categoryImages.fashion
        const home = {
            ...(existing.home || {}),
            categoryImages: {
                ...(existing.home?.categoryImages || {}),
                fashion: '/images/brand/mae-collective-home.png',
            },
        };

        // 2. Update fashion collection subcategories (dresses-main, outfits-sets-main)
        const collections = (existing.collections || []).map((collection: any) => {
            if (collection.id !== 'fashion') return collection;
            return {
                ...collection,
                subcategories: (collection.subcategories || []).map((sub: any) => {
                    if (sub.id === 'dresses-main') {
                        return { ...sub, image: '/images/brand/mae-dress.png' };
                    }
                    if (sub.id === 'outfits-sets-main') {
                        return { ...sub, image: '/images/brand/mae-sets-v2.png' };
                    }
                    return sub;
                }),
            };
        });

        await ctx.db.patch(existing._id, { home, collections });
        return { success: true, message: "Updated dresses, sets, and fashion category images" };
    },
});

// One-time migration: Flatten Home Decor subcategories for CurvedCategoryCarousel
// Removes isMainCategory/parentCategory so decor uses the standard carousel layout like Furniture
export const flattenDecorForCarousel = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const flatDecor = {
            id: 'decor',
            title: 'Home Decor',
            subtitle: 'The details that tell your story',
            heroImage: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=2000&auto=format&fit=crop',
            subcategories: [
                { id: 'decor-items', title: 'Decor Items', image: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=800', caption: 'Curated Objects' },
                { id: 'table-lamps', title: 'Table Lamps', image: 'https://images.unsplash.com/photo-1513506003011-3b03c8b063ca?q=80&w=800', caption: 'Ambient Light' },
                { id: 'vases', title: 'Vases', image: 'https://images.unsplash.com/photo-1612196808214-b7e239e5f6b7?q=80&w=800', caption: 'Ceramic & Glass' },
                { id: 'floor-lamps', title: 'Floor Lamps', image: 'https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?q=80&w=800', caption: 'Corner Brightening' },
                { id: 'rugs', title: 'Rugs', image: 'https://images.unsplash.com/photo-1599694239849-012b68328761?q=80&w=800', caption: 'Grounding Textures' },
                { id: 'accent-chairs', title: 'Accent Chairs', image: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?q=80&w=800', caption: 'Statement Seating' },
            ]
        };

        const collections = (existing.collections || []).map((c: any) =>
            c.id === 'decor' ? flatDecor : c
        );

        await ctx.db.patch(existing._id, { collections });
        return { success: true, message: "Home Decor flattened for CurvedCategoryCarousel layout" };
    },
});

// One-time migration: Update Furniture collection subcategory images to local brand assets
export const updateFurnitureImages = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const imageMap: Record<string, string> = {
            'accent-chairs': '/images/brand/furniture-chair.png',
            'barstools': '/images/brand/barstools v2 copy.png',
            'counterstools': '/images/brand/counterstools copy.png',
            'side-storage-cabinets': '/images/brand/sideboard cabinets copy.png',
            'dining-chairs': '/images/brand/dining chairs v2 copy.png',
            'dining-tables': '/images/brand/dining table copy.png',
            'entryway-tables': '/images/brand/entry table copy.png',
            'nightstands': '/images/brand/nightstands copy.png',
            'nursery-furniture': '/images/brand/nursery room copy.png',
            'playroom-furniture': '/images/brand/playroom-scene-v2.png',
        };

        const collections = (existing.collections || []).map((c: any) => {
            if (c.id === 'furniture') {
                return {
                    ...c,
                    subcategories: (c.subcategories || []).map((sub: any) => {
                        const newImage = imageMap[sub.id];
                        return newImage ? { ...sub, image: newImage } : sub;
                    }),
                };
            }
            return c;
        });

        await ctx.db.patch(existing._id, { collections });
        return { success: true, message: "Furniture subcategory images updated to local brand assets" };
    },
});

// One-time migration: Update Home Decor collection subcategory images to local brand assets
export const updateDecorImages = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const imageMap: Record<string, string> = {
            'rugs': '/images/brand/rug copy.png',
            'table-lamps': '/images/brand/table lamp v2 copy.png',
            'floor-lamps': '/images/brand/floorlamp copy.png',
            'accent-chairs': '/images/brand/accent chair1 copy.png',
            'vases': '/images/brand/decor-vase.png',
            'decor-items': '/images/brand/decor-mirror.png',
        };

        const collections = (existing.collections || []).map((c: any) => {
            if (c.id === 'decor') {
                return {
                    ...c,
                    subcategories: (c.subcategories || []).map((sub: any) => {
                        const newImage = imageMap[sub.id];
                        return newImage ? { ...sub, image: newImage } : sub;
                    }),
                };
            }
            return c;
        });

        await ctx.db.patch(existing._id, { collections });
        return { success: true, message: "Home Decor subcategory images updated to local brand assets" };
    },
});

// One-time migration: Update Mae Collective (fashion) collection subcategory images to local brand assets
export const updateFashionImages = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const imageMap: Record<string, string> = {
            'blazers-layers-main': '/images/brand/blazers.PNG',
            'active-lounge-main': '/images/brand/active.PNG',
            'vacation-edit': '/images/brand/vacation.PNG',
        };

        const collections = (existing.collections || []).map((c: any) => {
            if (c.id === 'fashion') {
                return {
                    ...c,
                    subcategories: (c.subcategories || []).map((sub: any) => {
                        const newImage = imageMap[sub.id];
                        return newImage ? { ...sub, image: newImage } : sub;
                    }),
                };
            }
            return c;
        });

        await ctx.db.patch(existing._id, { collections });
        return { success: true, message: "Mae Collective subcategory images updated to local brand assets" };
    },
});

// One-time migration: Update Mae Collective homepage category card image to MAECOL.png
export const updateMaeCollectiveHomeImage = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const home = {
            ...(existing.home || {}),
            categoryImages: {
                ...(existing.home?.categoryImages || {}),
                fashion: '/images/brand/MAECOL.png',
            },
        };

        await ctx.db.patch(existing._id, { home });
        return { success: true, message: "Mae Collective homepage card updated to MAECOL.png" };
    },
});

// One-time migration: Add shop.headerImage to home content
export const updateShopHeaderImage = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const home = {
            ...(existing.home || {}),
            shop: {
                ...(existing.home?.shop || {}),
                headerImage: '/images/brand/DINNERTABLE.png',
            },
        };

        await ctx.db.patch(existing._id, { home });
        return { success: true, message: "Shop header image set to DINNERTABLE.png" };
    },
});

// One-time migration: Update Mae Collective homepage + shop card image to maev2.png
export const updateMaeCollectiveToMaev2 = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const home = {
            ...(existing.home || {}),
            categoryImages: {
                ...(existing.home?.categoryImages || {}),
                fashion: '/images/brand/maev2.png',
            },
        };

        await ctx.db.patch(existing._id, { home });
        return { success: true, message: "Mae Collective homepage/shop card updated to maev2.png" };
    },
});

// One-time migration: Update Our Story hero image to fam2.png
export const updateStoryHeroImage = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const story = {
            ...(existing.story || {}),
            hero: {
                ...(existing.story?.hero || {}),
                image: '/images/brand/fam2.png',
            },
        };

        await ctx.db.patch(existing._id, { story });
        return { success: true, message: "Our Story hero image updated to fam2.png" };
    },
});

// One-time migration: Update Our Story chapter text with full narrative content
export const updateStoryChapters = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        const story = {
            ...(existing.story || {}),
            chapters: {
                oneTitle: "The Heart Behind the Name",
                oneText: "Our name carries deep meaning. L.O.U.I.E. embodies the heart of our mission:\n\nLiving surrendered\nOverflowing with His grace\nUsing our gifts in faithful service\nInfluencing with intention\nEstablishing a legacy of faith\n\nM.A.E. is my full name, Monica Alexandra Estimon, but it's also a love story. Long before Louie Mae was born, my husband Denis surprised me with an album titled \"Sweet Mae,\" filled with songs he wrote and sang over me throughout the years. That nickname stayed tucked in my heart. When it came time to name this venture, it felt only right to blend Louie and Mae—a union of love, creativity, and calling.",
                twoTitle: "From Garage Sparks to Boutique Dreams",
                twoText: "Louie Mae started long before the brand had a name. As a young single mom, I found myself rediscovering life in my parents' garage, where my uncle introduced me to the world of artisan jewelry. That space became my sanctuary. Through his workshops, I was taught metalsmithing, wirework, resin casting, and woodworking. I began creating my own designs and soon launched my first brand, The Garden on Earth.\n\nLife moved fast. I eventually relocated to Texas to live near that same uncle and immerse myself even deeper. There, I met small business owners, learned about product-making, and was welcomed into a creative community of makers and small business owners who breathed life into dreams. Their stories lit a fire in me.\n\nMy first serious job was at Cobblestone Cottage, a small family-owned boutique in Texas. It was there I fell in love with intentional curation—seasonal decor, women's clothing, artisan goods, and charming children's pieces. The store was cozy, intimate, and full of soul… The kind of place where every shelf tells a story.\n\nWhen I moved on for a more sustainable role, I became a sales associate at Ashley Homestore, where I fell in love with home design. I still remember walking the showroom early in the mornings, taking in each carefully styled corner, each piece chosen to make a space feel like home. It ignited my love for interiors.",
                threeTitle: "A New Chapter: Love & Legacy",
                threeText: "In the midst of rebuilding, I met Denis Estimon, my now husband. I was mentoring at a youth conference where he was a guest speaker. A visionary, a leader, and the founder of a national student-led movement, Denis spoke about taking ownership of your future, choosing purpose over comfort, and making hard, intentional decisions; Legacy over comfort. His words shook something in me—I saw the kind of leader, husband, and father I had always prayed for.\n\nIt wasn't long before our lives intertwined. We shared the same foundation—faith, values, vision, convictions, and creativity. We married shortly after, and our family grew fast. Life accelerated.\n\nWith a newborn in arms and a 6-year-old by my side, I launched Louie Mae as a curated children's boutique. It was my dream, my spark—but life as a new mom of two was demanding. Between postpartum, motherhood, and learning how to run a business, I had to pause.",
                fourTitle: "A Pause That Prepared Me",
                fourText: "Now, nearly three years later, I return to this dream refined, rooted, and ready. Today I'm a stay-at-home mother of four, and I have spent these quiet years growing, learning, and building. I've nurtured relationships with manufacturers and studied tools and systems to make LouieMae.com not just a store—but a reflection of everything I love and believe in.\n\nLouie Mae is more than a brand. It's the fruit of surrender and stewardship. It carries the fingerprints of faith, family, resilience, and grace.\n\nFrom artisan jewelry to curated children's clothing, timeless home decor and pieces that carry generational weight—we curate not just products, but presence. May you leave this space feeling seen, inspired, and reminded of your own unique calling."
            },
        };

        await ctx.db.patch(existing._id, { story });
        return { success: true, message: "Our Story chapters updated with full narrative content" };
    },
});

// One-time migration: Fix Girls/Boys Bottoms subcategory hierarchy
// Moves Leggings/Shorts/Pants/Skirts under "Girls Bottoms" and Shorts/Pants/Joggers under "Boys Bottoms"
export const fixBottomsSubcategories = mutation({
    args: {},
    handler: async (ctx) => {
        await requireCjAdminIdentity(ctx);
        const existing = await ctx.db.query("siteContent").first();
        if (!existing) return { success: false, message: "No siteContent found" };

        // Map of subcategory IDs to their new parentCategory
        const parentCategoryFixes: Record<string, string> = {
            'girls-leggings': 'Girls Bottoms',
            'girls-shorts': 'Girls Bottoms',
            'girls-pants': 'Girls Bottoms',
            'girls-skirts': 'Girls Bottoms',
            'boys-shorts': 'Boys Bottoms',
            'boys-pants': 'Boys Bottoms',
            'boys-joggers': 'Boys Bottoms',
        };

        const collections = (existing.collections || []).map((collection: any) => {
            if (collection.id !== 'kids') return collection;
            return {
                ...collection,
                subcategories: (collection.subcategories || []).map((sub: any) => {
                    if (parentCategoryFixes[sub.id]) {
                        return { ...sub, parentCategory: parentCategoryFixes[sub.id] };
                    }
                    return sub;
                }),
            };
        });

        await ctx.db.patch(existing._id, { collections });
        return { success: true, message: "Fixed Girls/Boys Bottoms subcategory hierarchy" };
    },
});
