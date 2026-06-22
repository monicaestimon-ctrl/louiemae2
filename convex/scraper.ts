"use node";
import { action } from "./_generated/server";
import { ConvexError, v } from "convex/values";

/** Domain allowlist: only scrape from known storefront domains. */
const ALLOWED_DOMAINS = [
    '1688.com',
    'detail.1688.com',
    'm.1688.com',
    'aliexpress.com',
    'aliexpress.us',
    'amazon.com',
    'amazon.co.uk',
    'amazon.ca',
    'ebay.com',
    'etsy.com',
    'walmart.com',
    'target.com',
    'trendsi.com',
    'shopify.com',
    'myshopify.com',
];

/** Checks if a hostname matches the allowed storefront domains (supports subdomains). */
const isAllowedDomain = (hostname: string): boolean => {
    const h = hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(domain =>
        h === domain || h.endsWith(`.${domain}`)
    );
};

/** SSRF defense-in-depth: checks if a hostname resolves to private/internal IPs or IPv6 literals. */
const isBlockedHost = (hostname: string): boolean => {
    const h = hostname.toLowerCase();
    // Reject IPv6 literals (e.g. [::1], [fe80::1])
    if (h.startsWith('[') || h.includes(':')) return true;
    // Check for IP-based private ranges with proper octet parsing
    const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const a = Number(ipv4[1]);
        const b = Number(ipv4[2]);
        if (a === 127 || a === 10 || a === 0 ||
            (a === 192 && b === 168) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31)) {
            return true;
        }
    }
    return (
        h === 'localhost' ||
        h.endsWith('.local') ||
        h.endsWith('.internal')
    );
};

const getScraperErrorCode = (message: string): string => {
    if (/domain not supported|unsupported domain|redirect hop landed on unsupported/i.test(message)) return 'UNSUPPORTED_DOMAIN';
    if (/blocked internal|blocked host/i.test(message)) return 'BLOCKED_URL';
    if (/invalid url|invalid redirect|invalid protocol|invalid url format/i.test(message)) return 'INVALID_URL';
    if (/rapidapi key not configured/i.test(message)) return 'MISSING_RAPIDAPI_KEY';
    if (/otapi request timed out|aborted|timed out/i.test(message)) return 'UPSTREAM_TIMEOUT';
    if (/http 403|http 401/i.test(message)) return 'UPSTREAM_FORBIDDEN';
    if (/otapi|rapidapi/i.test(message)) return 'UPSTREAM_API_ERROR';
    if (/could not extract meaningful data/i.test(message)) return 'EXTRACTION_FAILED';
    return 'SCRAPE_FAILED';
};

export const scrapeProduct = action({
    args: { url: v.string() },
    handler: async (ctx, { url }) => {
        console.log(`[Scraper] Starting scrape for URL: ${url}`);

        try {
            // Validate URL format
            // Validate URL format — only allow http/https
            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch {
                throw new Error(`Invalid URL format: "${url}". URL must be a valid http:// or https:// URL.`);
            }
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                throw new Error(`Invalid URL protocol: "${parsedUrl.protocol}". Only http:// and https:// are allowed.`);
            }

            // Validate against domain allowlist and SSRF blocklist
            try {
                const parsed = new URL(url);
                if (isBlockedHost(parsed.hostname)) {
                    throw new Error(`Blocked internal/private URL: "${parsed.hostname}"`);
                }
                if (!isAllowedDomain(parsed.hostname)) {
                    throw new Error(`Domain not supported for scraping: "${parsed.hostname}". Only known storefronts are allowed.`);
                }
            } catch (parseErr: any) {
                if (parseErr.message.startsWith('Blocked') || parseErr.message.startsWith('Domain')) throw parseErr;
                throw new Error(`Invalid URL: "${url}"`);
            }

            let resolvedUrl = url;

            // 1. Check for 1688.com product URLs
            // Support formats:
            // https://detail.1688.com/offer/838924089999.html
            // https://m.1688.com/offer/838924089999.html
            const match1688 = resolvedUrl.match(/1688\.com\/offer\/(\d+)\.html/);

            if (match1688) {
                const productId = match1688[1];
                console.log(`[Scraper] Detected 1688 product ID: ${productId}`);
                try {
                    return await scrape1688(productId, url);
                } catch (apiErr: any) {
                    // OTAPI failed — 1688 pages are JS-rendered so generic HTML
                    // scraping will almost certainly also fail. Throw a clear error
                    // instead of silently returning empty data.
                    console.error(`[Scraper] OTAPI failed for 1688 product ${productId}: ${apiErr.message}`);
                    throw new Error(
                        `Could not fetch 1688 product ${productId}. ` +
                        `OTAPI API error: ${apiErr.message}. ` +
                        `Please verify the product URL is valid and try again.`
                    );
                }
            }

            // 2. Generic Scraper (handles AliExpress, Amazon, and any other URLs)
            console.log(`[Scraper] Using generic scraper for: ${resolvedUrl}`);
            return await scrapeGeneric(resolvedUrl);

        } catch (err: any) {
            // Top-level catch: prevents generic "Server Error" from Convex
            // by throwing a properly formatted error with details
            const errorMessage = err?.message || 'Unknown scraping error';
            console.error(`[Scraper] FATAL ERROR scraping ${url}: ${errorMessage}`);
            console.error(`[Scraper] Stack: ${err?.stack || 'no stack trace'}`);
            throw new ConvexError({
                code: getScraperErrorCode(errorMessage),
                message: errorMessage,
            });
        }
    },
});

// Fetch product details from 1688.com via OTAPI API
/**
 * Fetches a 1688 product via OTAPI BatchGetItemFullInfo API.
 * Pre-unwraps the OTAPI Result envelope so callers receive the item
 * data directly under `data` instead of needing to dig into
 * `data.Result.Item` themselves.
 *
 * @param productId - The 1688 product ID (numeric string from URL).
 * @param originalUrl - The original URL for logging/error context.
 * @returns `{ source: '1688', data: <item>, apiType: 'otapi-1688' }`
 */
async function scrape1688(productId: string, originalUrl?: string) {
    const rapidApiKey = process.env.RAPIDAPI_KEY;

    if (!rapidApiKey) {
        throw new Error(
            "RapidAPI key not configured. " +
            "Please set RAPIDAPI_KEY in Convex dashboard → Settings → Environment Variables."
        );
    }

    const OTAPI_HOST = "otapi-1688.p.rapidapi.com";
    const otapiId = `abb-${productId}`;

    console.log(`[Scraper] Fetching 1688 product via OTAPI: ${otapiId}`);

    const headers = {
        "X-RapidAPI-Key": rapidApiKey,
        "x-rapidapi-host": OTAPI_HOST,
    };

    // Helper: extract image URLs from HTML string using multi-pass approach
    function extractImagesFromHtml(htmlStr: string): string[] {
        const images: string[] = [];
        // Two-pass: find each <img> tag, then pick the best attr in priority order
        const imgTagRegex = /<img\b[^>]*>/gi;
        const attrRegex = /\b(data-lazyload-src|data-src|data-original|src)\s*=\s*["']([^"']+)["']/gi;
        let match;
        while ((match = imgTagRegex.exec(htmlStr)) !== null) {
            const tag = match[0];
            const attrs: Record<string, string> = {};
            attrRegex.lastIndex = 0;
            let attrMatch;
            while ((attrMatch = attrRegex.exec(tag)) !== null) {
                attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
            }
            let imgUrl =
                attrs['data-lazyload-src'] ||
                attrs['data-src'] ||
                attrs['data-original'] ||
                attrs['src'];
            if (!imgUrl || imgUrl.length < 10) continue;
            if (imgUrl.startsWith('data:') || imgUrl.includes('icon') || imgUrl.includes('logo')) continue;
            if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
            if (!images.includes(imgUrl)) images.push(imgUrl);
        }
        // background-image: url(...)
        const bgRegex = /background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi;
        while ((match = bgRegex.exec(htmlStr)) !== null) {
            let imgUrl = match[1];
            if (!imgUrl || imgUrl.length < 10 || imgUrl.startsWith('data:')) continue;
            if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
            if (!images.includes(imgUrl)) images.push(imgUrl);
        }
        // Raw URLs that look like images (common in 1688 descriptions)
        const rawUrlRegex = /(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>]*)?)/gi;
        while ((match = rawUrlRegex.exec(htmlStr)) !== null) {
            let imgUrl = match[1];
            if (imgUrl.includes('icon') || imgUrl.includes('logo')) continue;
            if (!images.includes(imgUrl)) images.push(imgUrl);
        }
        return images;
    }

    try {
        // Fetch item details with Description block included
        const controller1 = new AbortController();
        const timeout1 = setTimeout(() => controller1.abort(), 30000);

        // Fire description fetch in parallel (longer timeout — 25s — since this is critical)
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 25000);
        const descPromise = fetch(
            `https://${OTAPI_HOST}/GetItemDescription?language=en&itemId=${otapiId}`,
            { headers, signal: controller2.signal }
        ).finally(() => clearTimeout(timeout2)).catch((err: any) => {
            console.warn(`[Scraper] GetItemDescription fetch failed (non-fatal): ${err.message}`);
            return null;
        });

        // Request Description block via blockList parameter
        let response: Response;
        try {
            response = await fetch(
                `https://${OTAPI_HOST}/BatchGetItemFullInfo?language=en&itemId=${otapiId}&blockList=Description`,
                { headers, signal: controller1.signal }
            );
        } finally {
            clearTimeout(timeout1);
        }

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '(unreadable)');
            console.error(`[Scraper] OTAPI HTTP ${response.status} for ${otapiId}: ${errorBody.slice(0, 500)}`);
            throw new Error(`OTAPI API HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log(`[Scraper] OTAPI response ErrorCode: ${data.ErrorCode}, HasError: ${data.Result?.HasError}`);

        if (data.ErrorCode !== 'Ok' || data.Result?.HasError) {
            const errCode = data.Result?.ErrorCode || data.ErrorCode || 'unknown';
            console.error(`[Scraper] OTAPI returned error: ${errCode}`);
            throw new Error(`OTAPI Error: ${errCode}`);
        }

        // Unwrap the Result envelope so the consumer gets the item directly.
        const item = data.Result?.Item || data.Result || data;

        if (!item || typeof item !== 'object') {
            throw new Error('OTAPI returned empty item data');
        }

        const title = item.Title || item.OriginalTitle;
        console.log(`[Scraper] Successfully fetched 1688 product: "${title || '(no title)'}"`);

        // Always log image/description-related keys for debugging
        const imageKeys = Object.keys(item).filter(k =>
            /image|picture|photo|desc|external/i.test(k)
        );
        console.log(`[Scraper] Item image-related keys: ${JSON.stringify(imageKeys)}`);
        imageKeys.forEach(k => {
            const val = item[k];
            if (Array.isArray(val)) {
                console.log(`[Scraper]   ${k}: Array[${val.length}]`);
            } else if (typeof val === 'string') {
                console.log(`[Scraper]   ${k}: string (${val.length} chars)`);
            } else if (val && typeof val === 'object') {
                console.log(`[Scraper]   ${k}: object { ${Object.keys(val).join(', ')} }`);
            } else {
                console.log(`[Scraper]   ${k}: ${typeof val}`);
            }
        });

        // ── Helpers ──

        // Extract all HTML string candidates from a possibly-nested OTAPI node
        const getHtmlCandidates = (node: any): string[] =>
            [
                node?.Html,
                node?.Description,
                node?.Content,
                node?.Content?.Html,
                node?.Content?.Description,
                node?.ItemDescription,
                node?.ItemDescription?.Html,
                node?.ItemDescription?.Description,
                node?.OtapiItemDescription?.ItemDescription,
                node?.OtapiItemDescription?.Html,
                node?.OtapiItemDescription?.Description,
            ].filter((v): v is string => typeof v === 'string' && v.length > 50);

        // Normalize + dedupe helper for image URLs
        const pushImage = (url: string) => {
            const normalized = url.startsWith('//') ? `https:${url}` : url;
            if (normalized.length > 10 && !descriptionImages.includes(normalized)) {
                descriptionImages.push(normalized);
            }
        };

        // ── Collect description/marketing images from ALL available sources ──

        const descriptionImages: string[] = [];

        // Source 1: Description block from BatchGetItemFullInfo (blockList=Description)
        const descBlock = item.Description || data.Result?.Description || data.Description;
        if (descBlock) {
            console.log(`[Scraper] Found Description block, type: ${typeof descBlock}`);
            if (typeof descBlock === 'string' && descBlock.length > 50) {
                const extracted = extractImagesFromHtml(descBlock);
                extracted.forEach(pushImage);
                console.log(`[Scraper] Source 1 (Description string): ${extracted.length} images`);
            } else if (typeof descBlock === 'object') {
                // Extract HTML from any nested shape (Html, Content.Html, ItemDescription.Html, etc.)
                const htmlCandidates = getHtmlCandidates(descBlock);
                for (const html of htmlCandidates) {
                    const extracted = extractImagesFromHtml(html);
                    extracted.forEach(pushImage);
                    console.log(`[Scraper] Source 1 (Description nested HTML): ${extracted.length} images from ${html.length} chars`);
                }
                // Structured images array
                const imgArray = descBlock.Images || descBlock.DescriptionImages || descBlock.Pictures;
                if (Array.isArray(imgArray)) {
                    imgArray.forEach((img: any) => {
                        const url = typeof img === 'string' ? img : img?.Url || img?.Large?.Url || img?.Original?.Url;
                        if (url && typeof url === 'string') pushImage(url);
                    });
                    console.log(`[Scraper] Source 1 (Description.Images): ${imgArray.length} items`);
                }
            }
        }

        // Source 2: Standalone DescriptionImages / ExternalDescription on item
        for (const key of ['DescriptionImages', 'ExternalDescription', 'ItemDescription']) {
            const val = item[key];
            if (Array.isArray(val)) {
                val.forEach((img: any) => {
                    const url = typeof img === 'string' ? img : img?.Url || img?.Large?.Url;
                    if (url && typeof url === 'string') pushImage(url);
                });
                console.log(`[Scraper] Source 2 (item.${key}): ${val.length} items`);
            } else if (typeof val === 'string' && val.length > 50) {
                const extracted = extractImagesFromHtml(val);
                extracted.forEach(pushImage);
                console.log(`[Scraper] Source 2 (item.${key} HTML): ${extracted.length} images`);
            } else if (val && typeof val === 'object') {
                // Handle object-shaped values (e.g. { Html: "..." })
                const htmlCandidates = getHtmlCandidates(val);
                for (const html of htmlCandidates) {
                    const extracted = extractImagesFromHtml(html);
                    extracted.forEach(pushImage);
                    console.log(`[Scraper] Source 2 (item.${key} nested HTML): ${extracted.length} images`);
                }
            }
        }

        // Source 3: GetItemDescription API response (fallback)
        const descResult = await descPromise;
        if (descResult && descResult.ok) {
            try {
                const descData = await descResult.json();
                console.log(`[Scraper] GetItemDescription response keys: ${JSON.stringify(Object.keys(descData || {}))}`);

                // PRIMARY: OTAPI returns description HTML at OtapiItemDescription.ItemDescription
                const otapiDescHtml = descData?.OtapiItemDescription?.ItemDescription;
                if (typeof otapiDescHtml === 'string' && otapiDescHtml.length > 50) {
                    const extracted = extractImagesFromHtml(otapiDescHtml);
                    extracted.forEach(pushImage);
                    console.log(`[Scraper] Source 3 (OtapiItemDescription.ItemDescription): ${extracted.length} images from ${otapiDescHtml.length} char HTML`);
                } else {
                    console.log(`[Scraper] OtapiItemDescription.ItemDescription: ${otapiDescHtml ? `${typeof otapiDescHtml} (${String(otapiDescHtml).length} chars)` : 'missing'}`);
                }

                // FALLBACK: scan top-level and Result.* for any other HTML strings
                const htmlStrings = getHtmlCandidates(descData).filter(html => html !== otapiDescHtml);
                if (descData?.Result && typeof descData.Result === 'object' && Object.keys(descData.Result).length > 0) {
                    console.log(`[Scraper] GetItemDescription Result keys: ${JSON.stringify(Object.keys(descData.Result))}`);
                    htmlStrings.push(...getHtmlCandidates(descData.Result));
                }
                if (typeof descData?.Result === 'string' && descData.Result.length > 50) {
                    htmlStrings.push(descData.Result);
                }
                if (htmlStrings.length > 0) {
                    const seenHtml = new Set<string>();
                    for (const html of htmlStrings) {
                        if (seenHtml.has(html)) continue;
                        seenHtml.add(html);
                        const extracted = extractImagesFromHtml(html);
                        extracted.forEach(pushImage);
                        console.log(`[Scraper] Source 3 fallback: ${extracted.length} images from ${html.length} char HTML`);
                    }
                }

                // Process ALL structured image arrays (not just the first truthy one)
                const descImageArrays = [
                    descData?.OtapiItemDescription?.Images,
                    descData?.Result?.Images,
                    descData?.Result?.DescriptionImages,
                ].filter((value): value is any[] => Array.isArray(value));
                for (const imgArray of descImageArrays) {
                    imgArray.forEach((img: any) => {
                        const url = typeof img === 'string' ? img : img?.Url || img?.Large?.Url;
                        if (url && typeof url === 'string') pushImage(url);
                    });
                    console.log(`[Scraper] Source 3 (images array): ${imgArray.length} items`);
                }
            } catch (descErr: any) {
                console.warn(`[Scraper] Failed to parse description response: ${descErr.message}`);
            }
        } else if (descResult) {
            console.warn(`[Scraper] GetItemDescription HTTP ${descResult.status} (non-fatal)`);
        } else {
            console.warn(`[Scraper] GetItemDescription returned null (timeout or network error)`);
        }

        console.log(`[Scraper] Total description/marketing images collected: ${descriptionImages.length}`);

        return {
            source: '1688' as const,
            data: item,
            descriptionImages,
            apiType: 'otapi-1688',
        };

    } catch (e: any) {
        if (e.name === 'AbortError') {
            throw new Error(`OTAPI request timed out after 30s for product ${productId}`);
        }
        throw new Error(`OTAPI 1688 API failed: ${e.message}`);
    }
}


/**
 * Generic HTML scraper with manual redirect handling and SSRF validation per hop.
 * Extracts title, description, images, and price from meta tags and HTML content.
 * @param url - The URL to scrape (must be on an allowed domain).
 * @returns Scraped product data with source 'generic'.
 */
async function scrapeGeneric(url: string) {
    try {
        let response: Response | undefined;
        let currentUrl = url;
        const MAX_REDIRECTS = 5;

        // Manual redirect handling: validate each hop against allowlist + SSRF
        try {
            for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                try {
                    response = await fetch(currentUrl, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                            "Accept-Language": "en-US,en;q=0.9",
                        },
                        redirect: 'manual',
                        signal: controller.signal,
                    });
                } finally {
                    clearTimeout(timeoutId);
                }

                // Check for redirect (3xx)
                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get('location');
                    if (!location) break; // No Location header — treat as final

                    // Resolve relative redirects against current URL
                    let nextUrl: string;
                    try {
                        nextUrl = new URL(location, currentUrl).toString();
                    } catch {
                        throw new Error(`Invalid redirect URL: "${location}"`);
                    }

                    // Validate redirect target
                    const nextParsed = new URL(nextUrl);
                    if (isBlockedHost(nextParsed.hostname)) {
                        throw new Error(`Redirect hop landed on blocked host: "${nextParsed.hostname}"`);
                    }
                    if (!isAllowedDomain(nextParsed.hostname)) {
                        throw new Error(`Redirect hop landed on unsupported domain: "${nextParsed.hostname}"`);
                    }

                    currentUrl = nextUrl;
                    if (hops === MAX_REDIRECTS) {
                        throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
                    }
                    continue;
                }
                break; // Not a redirect — this is the final response
            }
        } catch (e: any) {
            throw e; // Re-throw SSRF/redirect errors
        }

        const finalUrl = currentUrl;

        if (!response) {
            throw new Error('No response received from server');
        }

        if (!response.ok) {
            throw new Error(`Failed to load page: HTTP ${response.status} ${response.statusText}`);
        }

        const html = await response.text();
        console.log(`[Scraper] Fetched ${html.length} bytes from ${url}`);

        // Extract meta tags
        const getMeta = (prop: string) => {
            const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
                html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
            return match ? match[1] : null;
        };

        const title = getMeta('og:title') ||
            getMeta('twitter:title') ||
            html.match(/<title>([^<]+)<\/title>/i)?.[1] ||
            'Unknown Product';

        const description = getMeta('og:description') ||
            getMeta('description') ||
            getMeta('twitter:description') ||
            '';

        // Extract images — collect multiple sources
        // Helper to resolve any URL (relative, protocol-relative, absolute) against the page
        const resolveUrl = (src: string): string => {
            if (!src) return '';
            try {
                return new URL(src, finalUrl).toString();
            } catch {
                return src.startsWith('//') ? `https:${src}` : src;
            }
        };

        const images: string[] = [];
        const ogImage = getMeta('og:image');
        if (ogImage) images.push(resolveUrl(ogImage));
        const twitterImage = getMeta('twitter:image');
        if (twitterImage && twitterImage !== ogImage) {
            images.push(resolveUrl(twitterImage));
        }

        // Look for additional product images in the HTML
        const imgMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
        for (const match of imgMatches) {
            const imgSrc = match[1];
            // Skip tiny icons, tracking pixels, logos, etc.
            if (imgSrc.includes('pixel') || imgSrc.includes('icon') || imgSrc.includes('logo') ||
                imgSrc.includes('avatar') || imgSrc.includes('flag') || imgSrc.includes('badge') ||
                imgSrc.includes('.svg') || imgSrc.includes('1x1') || imgSrc.includes('blank') ||
                imgSrc.includes('data:image') || imgSrc.length < 10) continue;
            const resolved = resolveUrl(imgSrc);
            // Accept images matching common extensions or CDN/hosting patterns
            const hasImageExt = /\.(jpe?g|png|webp|avif)(\?|$)/i.test(resolved);
            const hasCdnPattern = /(cdn|cloudfront|cloudinary|s3\.amazonaws|imgix|akamai|media|upload|photo|product|item|pic)/i.test(resolved);
            const hasSizeParam = /(\d{2,4}x\d{2,4}|width=|height=|w=\d|h=\d|resize)/i.test(resolved);
            if ((hasImageExt || hasCdnPattern || hasSizeParam) &&
                !images.includes(resolved) && images.length < 10) {
                images.push(resolved);
            }
        }

        // Extract price
        const priceAmount = getMeta('og:price:amount') ||
            getMeta('product:price:amount');
        let price = priceAmount ? parseFloat(priceAmount) : 0;

        // If no meta price, try common price patterns in HTML
        if (!price) {
            const priceMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/i) ||
                html.match(/\$\s*([\d]+\.[\d]{2})/);
            if (priceMatch) price = parseFloat(priceMatch[1]) || 0;
        }

        const currency = getMeta('og:price:currency') ||
            getMeta('product:price:currency') || 'USD';

        if (title === 'Unknown Product' && images.length === 0) {
            throw new Error("Could not extract meaningful data from this page");
        }

        return {
            source: 'generic',
            data: {
                title: title.trim(),
                description: description.trim(),
                image: images[0] || null,
                images, // pass all found images
                price,
                currency,
                url: finalUrl
            }
        };

    } catch (err: any) {
        throw new Error(`Scraping failed: ${err.message}`);
    }
}
