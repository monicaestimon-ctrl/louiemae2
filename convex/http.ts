import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";
import Stripe from "stripe";

const http = httpRouter();

// Add Convex Auth routes
auth.addHttpRoutes(http);

// Helper for CORS headers - allow both production and development origins
const ALLOWED_ORIGINS = [
    "https://louiemae.com",
    "https://www.louiemae.com",
    "http://localhost:3000",
    "http://localhost:5173",
];

const getAllowedOrigin = (requestOrigin?: string | null) => {
    // If request origin is in allowed list, return it (for proper CORS)
    if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
        return requestOrigin;
    }
    // Fallback to production or development default
    return process.env.SITE_URL || "http://localhost:3000";
};

// Default CORS headers (will be overridden with request-specific origin)
const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // Will be set dynamically in handlers
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

// Create Stripe checkout session
http.route({
    path: "/stripe/checkout",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

        if (!stripeSecretKey) {
            return new Response(
                JSON.stringify({ error: "Stripe not configured. Please set STRIPE_SECRET_KEY in Convex dashboard." }),
                {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json",
                        ...corsHeaders,
                    }
                }
            );
        }

        const stripe = new Stripe(stripeSecretKey);

        try {
            const body = await request.json();
            const { items, successUrl, cancelUrl } = body;

            // Create line items for Stripe
            const lineItems = items.map((item: any) => ({
                price_data: {
                    currency: "usd",
                    product_data: {
                        name: item.name,
                        images: item.image ? [item.image] : [],
                    },
                    unit_amount: Math.round(item.price * 100), // Convert to cents
                },
                quantity: item.quantity,
            }));

            // Create checkout session with shipping
            const session = await stripe.checkout.sessions.create({
                mode: "payment",
                line_items: lineItems,
                success_url: successUrl,
                cancel_url: cancelUrl,
                billing_address_collection: "required",
                shipping_address_collection: {
                    allowed_countries: ["US", "CA", "GB", "AU"],
                },
                shipping_options: [
                    {
                        shipping_rate_data: {
                            type: "fixed_amount",
                            fixed_amount: { amount: 999, currency: "usd" },
                            display_name: "Standard Shipping",
                            delivery_estimate: {
                                minimum: { unit: "business_day", value: 5 },
                                maximum: { unit: "business_day", value: 7 },
                            },
                        },
                    },
                    {
                        shipping_rate_data: {
                            type: "fixed_amount",
                            fixed_amount: { amount: 1999, currency: "usd" },
                            display_name: "Express Shipping",
                            delivery_estimate: {
                                minimum: { unit: "business_day", value: 2 },
                                maximum: { unit: "business_day", value: 3 },
                            },
                        },
                    },
                ],
                metadata: {
                    items: JSON.stringify(items.map((item: any) => ({
                        productId: item.productId,
                        variantId: item.variantId,
                        variantName: item.variantName,
                        // CJ fulfillment - pass variant-level CJ IDs
                        cjVariantId: item.cjVariantId,
                        cjSku: item.cjSku,
                        name: item.name,
                        price: item.price,
                        quantity: item.quantity,
                    }))),
                },
            });

            return new Response(
                JSON.stringify({ sessionId: session.id, url: session.url }),
                {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                        ...corsHeaders,
                    }
                }
            );
        } catch (error: any) {
            console.error("Stripe checkout error:", error);
            return new Response(
                JSON.stringify({ error: error.message || "Checkout failed" }),
                {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json",
                        ...corsHeaders,
                    }
                }
            );
        }
    }),
});

// CORS preflight handler
http.route({
    path: "/stripe/checkout",
    method: "OPTIONS",
    handler: httpAction(async () => {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }),
});

// Stripe webhook handler
http.route({
    path: "/stripe/webhook",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!stripeSecretKey) {
            return new Response("Stripe not configured", { status: 500 });
        }

        const stripe = new Stripe(stripeSecretKey);

        const signature = request.headers.get("stripe-signature");
        const body = await request.text();

        let event: Stripe.Event;

        try {
            if (webhookSecret && signature) {
                event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
            } else {
                // For testing without webhook signature verification
                event = JSON.parse(body) as Stripe.Event;
            }
        } catch (err: any) {
            console.error("Webhook signature verification failed:", err.message);
            return new Response(`Webhook Error: ${err.message}`, { status: 400 });
        }

        // Handle the event
        if (event.type === "checkout.session.completed") {
            const session = event.data.object as Stripe.Checkout.Session;

            // Parse items from metadata
            const itemsData = session.metadata?.items ? JSON.parse(session.metadata.items) : [];

            // Get shipping address from session
            const shippingDetails = (session as any).shipping_details;

            const shippingAddress = shippingDetails?.address ? {
                line1: shippingDetails.address.line1 || "",
                line2: shippingDetails.address.line2 || undefined,
                city: shippingDetails.address.city || "",
                state: shippingDetails.address.state || undefined,
                postalCode: shippingDetails.address.postal_code || "",
                country: shippingDetails.address.country || "",
            } : undefined;

            // Get customer phone if available
            const customerPhone = session.customer_details?.phone || shippingDetails?.phone || undefined;

            // Create order in database
            const orderId = await ctx.runMutation(api.orders.createOrder, {
                stripeSessionId: session.id,
                stripePaymentIntentId: session.payment_intent as string || undefined,
                customerEmail: session.customer_details?.email || "",
                customerName: session.customer_details?.name || undefined,
                customerPhone,
                items: itemsData,
                subtotal: (session.amount_subtotal || 0) / 100,
                shipping: (session.shipping_cost?.amount_total || 0) / 100,
                tax: (session.total_details?.amount_tax || 0) / 100,
                total: (session.amount_total || 0) / 100,
                currency: session.currency || "usd",
                shippingAddress,
            });

            // Send confirmation email via internal action
            if (session.customer_details?.email) {
                try {
                    await ctx.runAction(internal.emails.sendOrderConfirmation, {
                        customerEmail: session.customer_details.email,
                        customerName: session.customer_details.name || undefined,
                        orderId: session.id.slice(-12).toUpperCase(),
                        items: itemsData.map((item: any) => ({
                            name: item.name,
                            price: item.price,
                            quantity: item.quantity,
                        })),
                        subtotal: (session.amount_subtotal || 0) / 100,
                        shipping: (session.shipping_cost?.amount_total || 0) / 100,
                        total: (session.amount_total || 0) / 100,
                        shippingAddress,
                    });
                } catch (emailError: any) {
                    console.error("Failed to send email:", emailError.message);
                    // Don't fail the webhook if email fails
                }
            }

            // Forward order to CJ Dropshipping if items have CJ mapping
            const cjProducts = itemsData
                .filter((item: any) => item.cjVariantId || item.cjSku)
                .map((item: any) => ({
                    vid: item.cjVariantId || undefined,
                    sku: item.cjSku || undefined,
                    quantity: item.quantity,
                }));

            if (cjProducts.length > 0 && shippingAddress) {
                try {
                    await ctx.runAction(internal.cjDropshipping.createCjOrder, {
                        orderId,
                        orderNumber: session.id.slice(-12).toUpperCase(),
                        customerName: session.customer_details?.name || "Customer",
                        customerPhone: customerPhone || "",
                        customerEmail: session.customer_details?.email || "",
                        shippingAddress,
                        products: cjProducts,
                    });
                    console.log(`CJ order forwarding initiated for order ${orderId}`);
                } catch (cjError: any) {
                    console.error("Failed to forward order to CJ:", cjError.message);
                    // Don't fail the webhook if CJ order fails - it will be retried manually
                }
            }
        }

        return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }),
});


// ═══════════════════════════════════════════════════════════════════════════
// CJ DROPSHIPPING WEBHOOK
// Receives real-time notifications from CJ for order updates, tracking, etc.
// ═══════════════════════════════════════════════════════════════════════════

http.route({
    path: "/cj/webhook",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        try {
            const body = await request.json();

            console.log("CJ Webhook received:", JSON.stringify(body, null, 2));

            const { messageId, type, messageType, params } = body;

            if (!messageId || !type) {
                return new Response(JSON.stringify({ success: false, error: "Invalid webhook payload" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }

            // DEDUPLICATION: Check if we've already processed this webhook
            const alreadyProcessed = await ctx.runQuery(internal.cjHelpers.wasWebhookProcessed, { messageId });
            if (alreadyProcessed) {
                console.log(`CJ Webhook: Already processed messageId=${messageId}, skipping`);
                return new Response(JSON.stringify({ success: true, skipped: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }

            // Handle different webhook types
            // webhookHandled tracks whether the handler found and updated a matching product.
            // CRITICAL: Only mark the webhook as "processed" when handled === true.
            // If a handler fails to find the product (e.g., cjSourcingId not stored yet),
            // we intentionally leave the messageId unrecorded so CJ's retry can re-attempt.
            let webhookHandled = true;

            switch (type) {
                case "ORDER":
                    // Order status update from CJ
                    await handleCjOrderWebhook(ctx, params, messageType);
                    break;

                case "LOGISTIC":
                    // Tracking/logistics update
                    await handleCjLogisticsWebhook(ctx, params);
                    break;

                case "ORDERSPLIT":
                    // Order was split into multiple shipments by CJ
                    console.log("CJ Order Split:", JSON.stringify(params));
                    await handleCjOrderSplitWebhook(ctx, params);
                    break;

                case "SOURCINGCREATE":
                    // Per CJ docs: Sourcing result — the definitive sourcing approval/rejection.
                    // This is CJ's primary notification when a sourcing request completes.
                    // Contains: cjProductId, cjVariantId, cjVariantSku, cjSourcingId, status, failReason
                    console.log(`CJ SOURCINGCREATE:`, JSON.stringify(params));
                    webhookHandled = await handleCjSourcingCreateWebhook(ctx, params);
                    break;

                case "PRODUCT":
                    // Per CJ docs: Product catalog update (description, price, image, status changes)
                    // NOTE: This is NOT for sourcing results — use SOURCINGCREATE for that.
                    console.log(`CJ PRODUCT update:`, params);
                    await handleCjProductWebhook(ctx, params);
                    break;

                case "VARIANT":
                    // Variant info from CJ - contains the vid we need for fulfillment
                    console.log(`CJ VARIANT update:`, params);
                    await handleCjVariantWebhook(ctx, params);
                    break;

                case "STOCK":
                    // Stock updates - log for now
                    console.log(`CJ STOCK update:`, params);
                    break;

                default:
                    console.log(`Unknown CJ webhook type: ${type}`, params);
            }

            // Only record as processed if the handler actually found and updated a product.
            // This allows CJ retries to re-attempt if the first webhook fired before
            // the product's cjSourcingId was stored in the database.
            if (webhookHandled) {
                await ctx.runMutation(internal.cjHelpers.recordProcessedWebhook, {
                    messageId,
                    type,
                });
            } else {
                console.warn(
                    `CJ Webhook: ${type} handler did not find a matching product — ` +
                    `NOT marking messageId=${messageId} as processed (will allow CJ retry)`
                );
            }

            // CJ requires 200 response within 3 seconds
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });

        } catch (error: any) {
            console.error("CJ Webhook error:", error.message);
            return new Response(JSON.stringify({ success: false, error: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    }),
});

// Handle CJ Order status webhook
/** Handles CJ Dropshipping order status webhook events. */
async function handleCjOrderWebhook(ctx: any, params: any, messageType: string) {
    const { cjOrderId, orderNumber, orderStatus, trackNumber, logisticName, trackingUrl } = params;

    if (!orderNumber) {
        console.error("CJ Order webhook missing orderNumber");
        return;
    }

    console.log(`CJ Order ${orderNumber} status: ${orderStatus}, tracking: ${trackNumber}`);

    // Find order by order number (stripeSessionId last 12 chars uppercase)
    try {
        await ctx.runMutation(internal.cjHelpers.handleCjWebhookUpdate, {
            orderNumber,
            cjOrderId: cjOrderId?.toString(),
            cjStatus: mapCjOrderStatus(orderStatus),
            trackingNumber: trackNumber || undefined,
            trackingUrl: trackingUrl || undefined,
            carrier: logisticName || undefined,
        });
    } catch (error: any) {
        console.error("Failed to process CJ order webhook:", error.message);
    }
}

// Handle CJ ORDERSPLIT webhook — order was split into multiple shipments
async function handleCjOrderSplitWebhook(ctx: any, params: any) {
    const { originalOrderId, splitOrderList, orderSplitTime } = params;

    if (!originalOrderId) {
        console.error("CJ ORDERSPLIT webhook missing originalOrderId");
        return;
    }

    if (!Array.isArray(splitOrderList) || splitOrderList.length === 0) {
        console.warn(`CJ ORDERSPLIT: No split orders provided for original order ${originalOrderId}`);
        return;
    }

    console.log(`CJ ORDERSPLIT: Order ${originalOrderId} split into ${splitOrderList.length} shipments`);

    // Persist split data — let errors bubble so the webhook isn't marked as processed on failure
    const validSplitOrders = splitOrderList
        .map((split: any) => ({
            cjOrderId: split.orderCode || split.orderId || '',
            orderStatus: split.orderStatus ?? undefined,
            splitAt: orderSplitTime || new Date().toISOString(),
        }))
        .filter((s: any) => s.cjOrderId !== '');

    if (validSplitOrders.length === 0) {
        throw new Error(`CJ ORDERSPLIT: All ${splitOrderList.length} split children have missing order IDs — cannot persist`);
    }

    if (validSplitOrders.length < splitOrderList.length) {
        console.warn(`CJ ORDERSPLIT: Dropped ${splitOrderList.length - validSplitOrders.length} children with blank cjOrderId`);
    }

    await ctx.runMutation(internal.cjHelpers.handleCjOrderSplitUpdate, {
        originalCjOrderId: originalOrderId.toString(),
        splitOrders: validSplitOrders,
    });

    // Send customer notification — best-effort, fire-and-forget
    try {
        const order = await ctx.runQuery(internal.cjHelpers.getOrderByCjOrderId, {
            cjOrderId: originalOrderId.toString(),
        });
        if (order?.customerEmail) {
            // Don't await — let the email send asynchronously
            void ctx.runAction(internal.emails.sendOrderSplitNotification, {
                customerEmail: order.customerEmail,
                customerName: order.customerName || undefined,
                orderId: order.stripeSessionId.slice(-12).toUpperCase(),
                splitOrderIds: validSplitOrders.map(s => s.cjOrderId),
            }).catch((emailErr: any) => {
                console.warn(`CJ ORDERSPLIT: Email notification failed (non-fatal): ${emailErr.message}`);
            });
        }
    } catch (lookupErr: any) {
        // Non-fatal — order lookup for email shouldn't block the webhook
        console.warn(`CJ ORDERSPLIT: Order lookup for email failed (non-fatal): ${lookupErr.message}`);
    }
}

// Handle CJ Logistics/tracking webhook
/** Handles CJ Dropshipping logistics/tracking webhook events. */
async function handleCjLogisticsWebhook(ctx: any, params: any) {
    const { orderId, trackingNumber, logisticName, trackingStatus, trackingUrl } = params;

    console.log(`CJ Logistics update for order ${orderId}: ${trackingNumber}, status: ${trackingStatus}`);

    // Map CJ tracking status to our status
    let cjStatus: string = "shipped";
    if (trackingStatus === 12) {
        cjStatus = "delivered";
    } else if (trackingStatus === 13 || trackingStatus === 14) {
        cjStatus = "failed";
    }

    // Try primary update (parent order)
    await ctx.runMutation(internal.cjHelpers.handleCjLogisticsUpdate, {
        cjOrderId: orderId?.toString(),
        trackingNumber: trackingNumber || undefined,
        trackingUrl: trackingUrl || undefined,
        carrier: logisticName || undefined,
        cjStatus,
    });

    // Also try updating split order tracking (if this orderId is a split child)
    try {
        await ctx.runMutation(internal.cjHelpers.handleSplitOrderTrackingUpdate, {
            splitCjOrderId: orderId?.toString(),
            trackingNumber: trackingNumber || undefined,
            trackingUrl: trackingUrl || undefined,
            carrier: logisticName || undefined,
        });
    } catch (splitErr: any) {
        // Non-fatal — split order tracking is best-effort
        console.warn(`CJ Logistics: Split order tracking update failed (non-fatal): ${splitErr.message}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CJ SOURCINGCREATE WEBHOOK — Primary sourcing result handler
// Per CJ docs: This is sent when a sourcing request is completed or failed.
// Payload: { cjProductId, cjVariantId, cjVariantSku, cjSourcingId, status, failReason, createDate }
// ═══════════════════════════════════════════════════════════════════════════
async function handleCjSourcingCreateWebhook(ctx: any, params: any): Promise<boolean> {
    const {
        cjProductId,
        cjVariantId,
        cjVariantSku,
        cjSourcingId,
        status: rawStatus, // "completed" or "failed" (may arrive in different cases)
        failReason,
        createDate,
    } = params;

    // Normalize status to lowercase for case-insensitive matching.
    // CJ has been observed sending "completed", "Completed", and "COMPLETED".
    const status = typeof rawStatus === "string" ? rawStatus.toLowerCase() : rawStatus;

    console.log(`CJ SOURCINGCREATE: sourcingId=${cjSourcingId}, rawStatus=${rawStatus}, normalizedStatus=${status}, cjProductId=${cjProductId}, cjVariantId=${cjVariantId}, sku=${cjVariantSku}`);

    if (!cjSourcingId) {
        console.error("CJ SOURCINGCREATE webhook missing cjSourcingId");
        return false;
    }

    // ─── Strategy 1: Find product by cjSourcingId (most reliable link) ───
    let products = await ctx.runQuery(internal.cjHelpers.getProductByCjSourcingId, {
        cjSourcingId: String(cjSourcingId),
    });

    // Fail closed: if multiple products share the same cjSourcingId, that's a
    // data-integrity issue — bail out instead of silently mutating all matches.
    if (products && products.length > 1) {
        console.error(
            `CJ SOURCINGCREATE: DATA INTEGRITY ERROR — ${products.length} products share cjSourcingId=${cjSourcingId}. ` +
            `Refusing to update. Product IDs: ${products.map((p: any) => p._id).join(', ')}`
        );
        // Return true to mark as processed — retrying won't fix a data integrity issue
        return true;
    }

    // ─── Strategy 2: Fallback by cjProductId ───
    if ((!products || products.length === 0) && cjProductId) {
        console.log(`CJ SOURCINGCREATE: No match by sourcingId=${cjSourcingId}, trying cjProductId=${cjProductId}`);
        products = await ctx.runQuery(internal.cjHelpers.getProductByCjProductId, {
            cjProductId: String(cjProductId),
        });

        // Fail closed on non-unique cjProductId matches too
        if (products && products.length > 1) {
            console.error(
                `CJ SOURCINGCREATE: DATA INTEGRITY ERROR — ${products.length} products share cjProductId=${cjProductId}. ` +
                `Refusing to update. Product IDs: ${products.map((p: any) => p._id).join(', ')}`
            );
            return true;
        }
    }

    // ─── Strategy 3: Match by thirdProductId against pending/rejected products ───
    if (!products || products.length === 0) {
        console.log(`CJ SOURCINGCREATE: No match by sourcingId or productId, checking all pending products`);
        const pendingProducts = await ctx.runQuery(internal.cjHelpers.getProductsPendingSourcing, {});
        const rejectedProducts = await ctx.runQuery(internal.cjHelpers.getRejectedProductsForRecheck, {});
        const allCandidates = [...pendingProducts, ...rejectedProducts];

        // Try matching by thirdProductId (we set this to our internal product._id during sourcing create)
        if (params.thirdProductId) {
            const match = allCandidates.filter((p: any) => p._id === params.thirdProductId);
            if (match.length > 0) {
                products = match;
                console.log(`CJ SOURCINGCREATE: Matched by thirdProductId=${params.thirdProductId}`);
            }
        }
    }

    // ─── Strategy 4: Match by sourceUrl (last resort) ───
    // CJ's webhook payload sometimes includes productUrl. If all ID-based
    // strategies failed (e.g., cjSourcingId not stored yet because the
    // cron hadn't run), try matching by the original product URL.
    if ((!products || products.length === 0) && params.productUrl) {
        console.log(`CJ SOURCINGCREATE: Trying sourceUrl match: ${params.productUrl}`);
        const urlMatches = await ctx.runQuery(internal.cjHelpers.getProductBySourceUrl, {
            sourceUrl: params.productUrl,
        });
        // Only use URL match if it's unambiguous (exactly one product)
        if (urlMatches && urlMatches.length === 1) {
            products = urlMatches;
            console.log(`CJ SOURCINGCREATE: Matched by sourceUrl for ${urlMatches[0].name}`);
        } else if (urlMatches && urlMatches.length > 1) {
            console.warn(
                `CJ SOURCINGCREATE: ${urlMatches.length} products share sourceUrl=${params.productUrl}. ` +
                `Skipping ambiguous match. Product IDs: ${urlMatches.map((p: any) => p._id).join(', ')}`
            );
        }
    }

    if (!products || products.length === 0) {
        // CRITICAL: Return false so the webhook is NOT marked as processed.
        // This allows CJ's automatic retry to re-attempt delivery, and the
        // cron job will also pick this up as a safety net.
        console.error(
            `CJ SOURCINGCREATE: No product found for sourcingId=${cjSourcingId}. ` +
            `Webhook will NOT be marked as processed — CJ retry + cron will catch this.`
        );
        return false;
    }

    for (const product of products) {
        if (status === "completed") {
            // Sourcing succeeded! Update with all CJ IDs provided.
            console.log(`CJ SOURCINGCREATE APPROVED: ${product.name} → cjProductId=${cjProductId}, cjVariantId=${cjVariantId}, cjSku=${cjVariantSku}`);

            await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                productId: product._id,
                status: "approved",
                cjProductId: cjProductId || undefined,
                cjVariantId: cjVariantId || undefined,
                cjSku: cjVariantSku || undefined,
                sourcingId: String(cjSourcingId),
            });
        } else if (status === "failed") {
            // Sourcing actually failed — mark as rejected with reason
            console.log(`CJ SOURCINGCREATE REJECTED: ${product.name} → reason: ${failReason}`);

            await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                productId: product._id,
                status: "rejected",
                error: failReason || "Sourcing failed - CJ could not find a supplier",
                sourcingId: String(cjSourcingId),
            });
        } else {
            console.log(`CJ SOURCINGCREATE: Unknown status "${status}" for ${product.name}, logging only`);
        }
    }

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// CJ PRODUCT WEBHOOK — Catalog update handler (NOT sourcing results)
// Per CJ docs: Sent when a product in your CJ catalog is created or updated.
// Contains changed fields in params.fields[]. Used for keeping local catalog in sync.
// ═══════════════════════════════════════════════════════════════════════════
async function handleCjProductWebhook(ctx: any, params: any) {
    const { pid, productName, productNameEn, productStatus, productDescription, productImage, productSellPrice, fields } = params;

    if (!pid) {
        console.error("CJ Product webhook missing pid");
        return;
    }

    // Find product by CJ product ID in our database
    const products = await ctx.runQuery(internal.cjHelpers.getProductByCjProductId, { cjProductId: pid });

    if (!products || products.length === 0) {
        // This is normal — CJ sends PRODUCT updates for ALL catalog products,
        // not just ones we've sourced. Only process ones we have locally.
        console.log(`CJ PRODUCT webhook: No local product for pid=${pid}, ignoring catalog update`);
        return;
    }

    // Log which fields changed (CJ sends this in the `fields` array)
    const changedFields = fields || [];
    console.log(`CJ PRODUCT update for pid=${pid}: changed fields = [${changedFields.join(', ')}]`);

    for (const product of products) {
        // If productStatus is set and indicates the product was removed/disabled
        // from CJ's catalog, we should flag it.
        if (productStatus !== null && productStatus !== undefined) {
            // Per CJ docs: productStatus values aren't fully documented in the webhook guide,
            // but in the product detail API, active products have non-null status.
            // If the product is removed from CJ's catalog, we need to know.
            console.log(`CJ PRODUCT status change for ${product.name}: productStatus=${productStatus}`);
        }

        // Log the update for admin visibility — price and description changes
        // can be synced here in the future if needed.
        console.log(`CJ PRODUCT catalog update for ${product.name}: fields=[${changedFields.join(', ')}], ` +
            `name=${productNameEn || productName || '(unchanged)'}, price=${productSellPrice || '(unchanged)'}`);
    }
}

// Handle CJ Variant webhook (variant IDs for fulfillment)
/** Handles CJ Dropshipping variant/SKU webhook events. */
async function handleCjVariantWebhook(ctx: any, params: any) {
    const {
        pid,
        vid,
        variantSku,
        variantName,
        variantStatus,
        variantImage,
        variantSellPrice,
        variantValue1,
        variantValue2,
    } = params;

    if (!pid || !vid) {
        console.error("CJ Variant webhook missing pid or vid");
        return;
    }

    console.log(`Processing CJ Variant: pid=${pid}, vid=${vid}, sku=${variantSku}`);

    // Find product by CJ product ID
    const products = await ctx.runQuery(internal.cjHelpers.getProductByCjProductId, { cjProductId: pid });

    // If not found by CJ product ID, try to find pending products and link them
    if (!products || products.length === 0) {
        console.log(`CJ Variant webhook: No product found for pid=${pid}, trying to find pending products`);

        // Try to find pending products that might match this CJ product
        const pendingProducts = await ctx.runQuery(internal.cjHelpers.getProductsPendingSourcing, {});

        if (pendingProducts && pendingProducts.length > 0) {
            // Log available pending products for manual linking if needed
            console.log(`Found ${pendingProducts.length} pending products that could be linked to CJ pid=${pid}`);
        }
        return;
    }

    // Only process if variant is active (status 22)
    if (variantStatus !== 22) {
        console.log(`CJ Variant ${vid} has status ${variantStatus}, skipping (not active)`);
        return;
    }

    // Build a friendly variant name from available data
    const friendlyName = variantName ||
        (variantValue1 && variantValue2 ? `${variantValue1} - ${variantValue2}` :
            variantValue1 || variantValue2 || `Variant ${vid}`);

    // Build the CJ variant object
    const cjVariant = {
        vid: vid,
        sku: variantSku || "",
        name: friendlyName,
        price: variantSellPrice ? parseFloat(variantSellPrice) : undefined,
        image: variantImage,
    };

    // Append variant to each matching product
    for (const product of products) {
        console.log(`Appending CJ variant to ${product.name}: vid=${vid}, name=${friendlyName}`);

        await ctx.runMutation(internal.cjHelpers.appendCjVariant, {
            productId: product._id,
            cjVariant,
        });
    }
}


// Map CJ order status strings to our status
/** Maps CJ Dropshipping order status codes to internal status strings. */
function mapCjOrderStatus(cjStatus: string): string {
    const statusMap: Record<string, string> = {
        "CREATED": "confirmed",
        "IN_CART": "confirmed",
        "UNPAID": "confirmed",
        "UNSHIPPED": "processing",
        "SHIPPED": "shipped",
        "DELIVERED": "delivered",
        "CANCELLED": "cancelled",
    };
    return statusMap[cjStatus] || "processing";
}


// ═══════════════════════════════════════════════════════════════════════════
// OTAPI 1688 API PROXY ROUTES
// Proxies API calls to OTAPI 1688 on RapidAPI to avoid CORS and keep API key secure
// ═══════════════════════════════════════════════════════════════════════════

const RAPIDAPI_HOST = "otapi-1688.p.rapidapi.com";

// Map our sort options to OTAPI OrderBy values
/** Maps client-side sortBy value to OTAPI OrderBy parameter. */
function mapSortOrder(sortBy?: string): string {
    switch (sortBy) {
        case 'price_asc': return 'Price:Asc';
        case 'price_desc': return 'Price:Desc';
        case 'orders': return 'Popularity:Desc';
        case 'rating': return 'Popularity:Desc'; // OTAPI doesn't have rating sort, use popularity
        default: return 'Popularity:Desc';
    }
}

// Search products on 1688 via OTAPI
// NOTE: Route path "/aliexpress/search" is kept for backward compatibility.
// This endpoint now proxies to OTAPI 1688, not AliExpress.
http.route({
    path: "/aliexpress/search",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const rapidApiKey = process.env.RAPIDAPI_KEY;
        console.log(`[Search /aliexpress Debug] RAPIDAPI_KEY present: ${Boolean(rapidApiKey)}`);

        if (!rapidApiKey) {
            console.error('[Search /aliexpress Debug] RAPIDAPI_KEY is NOT set!');
            return new Response(
                JSON.stringify({ error: "RapidAPI key not configured. Please set RAPIDAPI_KEY in Convex dashboard." }),
                { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }

        try {
            const body = await request.json();
            const rawQuery = typeof body.query === 'string' ? body.query.trim() : '';
            if (!rawQuery) {
                return new Response(
                    JSON.stringify({ error: "Query parameter is required and must be a non-empty string" }),
                    { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
                );
            }
            const page = Math.max(1, Math.floor(Number(body.page) || 1));
            const pageSize = Math.min(100, Math.max(1, Math.floor(Number(body.pageSize) || 40)));
            const { minPrice, maxPrice, sortBy } = body;

            // OTAPI uses framePosition (0-based offset) and frameSize
            const framePosition = (page - 1) * pageSize;
            const params = new URLSearchParams({
                language: 'en',
                framePosition: String(framePosition),
                frameSize: String(pageSize),
                ItemTitle: rawQuery,
                OrderBy: mapSortOrder(sortBy),
            });

            // OTAPI prices are in CNY — convert USD input (configurable rate, default 7.2)
            const usdToCny = parseFloat(process.env.USD_CNY_RATE || '7.2') || 7.2;
            if (minPrice) {
                const parsed = parseFloat(minPrice);
                if (Number.isFinite(parsed)) params.append("MinPrice", String(Math.round(parsed * usdToCny)));
            }
            if (maxPrice) {
                const parsed = parseFloat(maxPrice);
                if (Number.isFinite(parsed)) params.append("MaxPrice", String(Math.round(parsed * usdToCny)));
            }

            const SEARCH_DEBUG = process.env.SEARCH_DEBUG === "true";
            const searchUrl = `https://${RAPIDAPI_HOST}/BatchSearchItemsFrame?${params.toString()}`;
            if (SEARCH_DEBUG) {
                console.log(`[Search /aliexpress Debug] page=${page}, pageSize=${pageSize}`);
                console.log(`[Search /aliexpress Debug] Fetching upstream endpoint: BatchSearchItemsFrame`);
            }

            const searchController = new AbortController();
            const searchTimeout = setTimeout(() => searchController.abort(), 15000);
            const fetchStart = Date.now();
            let response: Response;
            try {
                response = await fetch(
                    searchUrl,
                    {
                        method: "GET",
                        headers: {
                            "X-RapidAPI-Key": rapidApiKey,
                            "x-rapidapi-host": RAPIDAPI_HOST,
                            "Content-Type": "application/json",
                        },
                        signal: searchController.signal,
                    }
                );
            } finally {
                clearTimeout(searchTimeout);
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error("OTAPI 1688 Search Error:", {
                    status: response.status,
                    bodyLength: errorText.length,
                });
                return new Response(
                    JSON.stringify({ error: `API Error: ${response.status}` }),
                    { status: response.status, headers: { "Content-Type": "application/json", ...corsHeaders } }
                );
            }

            const data = await response.json();

            // Normalize through the same pipeline as aggregated search
            // so callers (searchProducts, getHotProducts) get a consistent shape
            const { products: normalized, totalCount: upstreamTotal } = normalizeOtapi1688(data);

            return new Response(
                JSON.stringify({
                    products: normalized,
                    totalCount: upstreamTotal,
                    currentPage: page,
                    totalPages: Math.ceil(upstreamTotal / pageSize),
                }),
                { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        } catch (error: any) {
            console.error("OTAPI 1688 search error:", error);
            const isTimeout = error?.name === 'AbortError';
            return new Response(
                JSON.stringify({ error: isTimeout ? 'Upstream request timed out' : (error.message || 'Search failed') }),
                { status: isTimeout ? 504 : 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }
    }),
});

// CORS preflight for search
http.route({
    path: "/aliexpress/search",
    method: "OPTIONS",
    handler: httpAction(async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
    }),
});

// Get product details by ID (OTAPI 1688)
// NOTE: Route path "/aliexpress/product" is kept for backward compatibility.
// This endpoint now proxies to OTAPI 1688, not AliExpress.
http.route({
    path: "/aliexpress/product",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const rapidApiKey = process.env.RAPIDAPI_KEY;

        if (!rapidApiKey) {
            return new Response(
                JSON.stringify({ error: "RapidAPI key not configured. Please set RAPIDAPI_KEY in Convex dashboard." }),
                { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }

        try {
            const body = await request.json();
            const productId = typeof body.productId === 'string' ? body.productId.trim() : '';

            if (!productId) {
                return new Response(
                    JSON.stringify({ error: "Product ID is required and must be a string" }),
                    { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
                );
            }

            // Ensure ID has the abb- prefix for OTAPI and validate format
            const otapiId = productId.startsWith('abb-') ? productId : `abb-${productId}`;
            if (!/^abb-\d+$/.test(otapiId)) {
                return new Response(
                    JSON.stringify({ error: "Product ID must be numeric (with optional abb- prefix)" }),
                    { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
                );
            }
            const detailParams = new URLSearchParams({ language: 'en', itemId: otapiId });

            const detailController = new AbortController();
            const detailTimeout = setTimeout(() => detailController.abort(), 15000);
            let response: Response;
            try {
                response = await fetch(
                    `https://${RAPIDAPI_HOST}/BatchGetItemFullInfo?${detailParams.toString()}`,
                    {
                        method: "GET",
                        headers: {
                            "X-RapidAPI-Key": rapidApiKey,
                            "x-rapidapi-host": RAPIDAPI_HOST,
                            "Content-Type": "application/json",
                        },
                        signal: detailController.signal,
                    }
                );
            } finally {
                clearTimeout(detailTimeout);
            }

            if (!response.ok) {
                console.error("OTAPI 1688 product detail error:", response.status);
                return new Response(
                    JSON.stringify({ error: `API Error: ${response.status}` }),
                    { status: response.status, headers: { "Content-Type": "application/json", ...corsHeaders } }
                );
            }

            const data = await response.json();

            if (data.ErrorCode !== 'Ok' || data.Result?.HasError) {
                console.error("OTAPI returned error:", data.ErrorCode, data.Result?.ErrorCode);
                return new Response(
                    JSON.stringify({ error: data.Result?.ErrorCode || data.ErrorCode || "Product not found" }),
                    { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
                );
            }

            return new Response(
                JSON.stringify(data),
                { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        } catch (error: any) {
            console.error("OTAPI 1688 product detail error:", error);
            const isTimeout = error?.name === 'AbortError';
            return new Response(
                JSON.stringify({ error: isTimeout ? 'Upstream request timed out' : (error.message || 'Failed to get product details') }),
                { status: isTimeout ? 504 : 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }
    }),
});

// CORS preflight for product details
http.route({
    path: "/aliexpress/product",
    method: "OPTIONS",
    handler: httpAction(async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
    }),
});

// ═══════════════════════════════════════════════════════════════════════════
// OTAPI 1688 AGGREGATED PRODUCT SEARCH
// Single-source search using OTAPI 1688 with multi-page parallel fetching
// ═══════════════════════════════════════════════════════════════════════════

interface NormalizedProduct {
    id: string;
    title: string;
    description?: string;
    price: number;
    originalPrice?: number;
    image: string;
    images?: string[];
    url: string;
    source: '1688';
    rating?: number;
    sales?: number;
    shipping?: string;
    /** Structured product attributes extracted from OTAPI FeaturedValues / Properties. */
    sourceProperties?: Record<string, string>;
    tierPricing?: Array<{ minQty: number; price: number }>;
    variants?: Array<{
        id: string;
        name: string;
        image?: string;
        priceAdjustment: number;
        inStock: boolean;
    }>;
}

// Shared OTAPI helpers — canonical extraction logic lives in lib/otapiHelpers.ts
import { getOtapiUsdPrice as getUsdPrice, getOtapiFeaturedValue as getFeaturedValue, extractOtapiSourceProperties, cleanOtapiDescription } from '../lib/otapiHelpers';

// Normalize OTAPI 1688 search results to NormalizedProduct[]
/** Result shape returned by normalizeOtapi1688. */
interface OtapiNormalizedResult {
    products: NormalizedProduct[];
    totalCount: number;
}

/**
 * Normalizes raw OTAPI BatchSearchItemsFrame response into a flat NormalizedProduct array.
 * Filters out items with missing title or zero price.
 * @returns Object containing normalized products and the upstream TotalCount.
 */
function normalizeOtapi1688(data: any): OtapiNormalizedResult {
    // OTAPI response nesting varies by API version — try multiple paths.
    // Coerce to array so an unexpected payload shape returns [] instead of a 500.
    const rawItems =
        data?.Result?.Items?.Items?.Content ||
        data?.Result?.Items?.Content ||
        data?.Result?.Content;
    const items = Array.isArray(rawItems) ? rawItems : [];
    const totalCount =
        data?.Result?.Items?.Items?.TotalCount ||
        data?.Result?.Items?.TotalCount ||
        data?.Result?.TotalCount ||
        items.length;

    // Diagnostic logging — gated behind SEARCH_DEBUG to keep production log volume low
    const debugNorm = process.env.SEARCH_DEBUG === 'true';
    if (debugNorm) {
        console.log(`[normalizeOtapi1688] Raw items found: ${items.length}, totalCount: ${totalCount}, ErrorCode: ${data?.ErrorCode || 'N/A'}`);
    }
    if (items.length === 0) {
        // Always warn on zero results — this is low-frequency and useful for triage
        const resultKeys = data?.Result ? Object.keys(data.Result).join(', ') : '(no Result)';
        console.warn(`[normalizeOtapi1688] 0 items extracted. Result keys: ${resultKeys}`);
    }

    const products = items.map((item: any) => {
        // Price — prefer PromotionPrice (discounted) over Price (regular)
        const promoPrice = getUsdPrice(item.PromotionPrice);
        const regularPrice = getUsdPrice(item.Price);
        const price = promoPrice > 0 ? promoPrice : regularPrice;

        // Images from Pictures array + PropertyPictures + ItemImages
        const pics = Array.isArray(item.Pictures) ? item.Pictures : [];
        const images = pics
            .map((pic: any) => pic?.Large?.Url || pic?.Medium?.Url || pic?.Url)
            .filter((url: any): url is string => typeof url === 'string' && url.length > 0);
        // Add variant/property images (different colors, etc.)
        if (Array.isArray(item.PropertyPictures)) {
            item.PropertyPictures.forEach((pic: any) => {
                const url = pic?.Large?.Url || pic?.Medium?.Url || pic?.Url || pic?.Original?.Url;
                if (typeof url === 'string' && url.length > 0 && !images.includes(url)) images.push(url);
            });
        }
        // Add additional item images if present
        if (Array.isArray(item.ItemImages)) {
            item.ItemImages.forEach((img: any) => {
                const url = typeof img === 'string' ? img : img?.Url || img?.Large?.Url;
                if (typeof url === 'string' && url.length > 0 && !images.includes(url)) images.push(url);
            });
        }
        const mainImage = item.MainPictureUrl || images[0] || '';

        // Rating and sales from FeaturedValues
        const rating = parseFloat(getFeaturedValue(item, 'rating') || '0') || undefined;
        const salesStr = getFeaturedValue(item, 'SalesInLast30Days') || getFeaturedValue(item, 'TotalSales');
        const sales = salesStr ? parseInt(salesStr, 10) : undefined;

        // ── Extract structured product attributes for AI description generation ──
        const sourceProperties = extractOtapiSourceProperties(item);

        // Description: clean text from item.Description if available
        const description = cleanOtapiDescription(item) || undefined;

        // URL
        const url = item.TaobaoItemUrl || item.ExternalItemUrl || '';

        // Tier pricing from QuantityRanges (stored as metadata, not variants)
        // These are bulk-pricing thresholds, not selectable SKUs
        const tierPricing: Array<{ minQty: number; price: number }> = [];
        if (Array.isArray(item.QuantityRanges) && item.QuantityRanges.length > 1) {
            item.QuantityRanges.forEach((range: any) => {
                const tierPrice = getUsdPrice(range.Price);
                tierPricing.push({
                    minQty: range.MinQuantity || 1,
                    price: tierPrice,
                });
            });
        }

        // Variants from ConfiguredItems (color/size SKUs) — for detail responses
        const variants: NormalizedProduct['variants'] = [];
        if (Array.isArray(item.ConfiguredItems) && item.ConfiguredItems.length > 0) {
            item.ConfiguredItems.forEach((cfg: any, index: number) => {
                const cfgPrice = getUsdPrice(cfg.Price);
                const cfgImage = cfg.Pictures?.[0]?.Large?.Url || cfg.Pictures?.[0]?.Url;
                const configuratorLabel = Array.isArray(cfg.Configurators)
                    ? cfg.Configurators
                        .map((c: any) => `${c?.PropertyName ?? c?.Pid ?? '?'}: ${c?.Value ?? c?.Vid ?? '?'}`)
                        .join(' / ')
                    : '';

                variants.push({
                    id: cfg.Id || `cfg_${index}`,
                    name: cfg.Title || configuratorLabel || `Option ${index + 1}`,
                    image: cfgImage || undefined,
                    priceAdjustment: cfgPrice ? cfgPrice - price : 0,
                    inStock: (cfg.Quantity ?? cfg.MasterQuantity ?? 0) > 0,
                });
            });
        }

        return {
            id: item.Id || '',
            title: item.Title || 'Unknown Product',
            description,
            price: price,
            originalPrice: promoPrice > 0 && regularPrice > promoPrice ? regularPrice : undefined,
            image: mainImage,
            images: images.length > 0 ? images : (mainImage ? [mainImage] : []),
            url: url,
            source: '1688' as const,
            rating: rating,
            sales: sales,
            sourceProperties: Object.keys(sourceProperties).length > 0 ? sourceProperties : undefined,
            tierPricing: tierPricing.length > 0 ? tierPricing : undefined,
            variants: variants.length > 0 ? variants : undefined,
        };
    }).filter((p: NormalizedProduct) => p.title && p.price > 0);

    if (debugNorm) {
        console.log(`[normalizeOtapi1688] After filtering: ${products.length} products (from ${items.length} raw items)`);
    }
    return { products, totalCount };
}

// Module-level constants for query optimization
const FILLER_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'in', 'on', 'to', 'of', 'that', 'this', 'is', 'i', 'my', 'me', 'need', 'want', 'looking', 'find', 'search', 'good', 'best', 'cheap', 'please', 'help']);
const SYNONYMS: Record<string, string> = { 'sofa': 'couch', 'couch': 'sofa', 'lamp': 'light', 'chair': 'seat', 'desk': 'table', 'rug': 'carpet' };

// Aggregated search endpoint (now OTAPI 1688 only)
http.route({
    path: "/products/search",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const rapidApiKey = process.env.RAPIDAPI_KEY;
        console.log(`[Search Debug] RAPIDAPI_KEY present: ${Boolean(rapidApiKey)}`);

        if (!rapidApiKey) {
            console.error('[Search Debug] RAPIDAPI_KEY is NOT set in Convex environment variables!');
            return new Response(
                JSON.stringify({ error: "RapidAPI key not configured. Please set RAPIDAPI_KEY in Convex dashboard environment variables." }),
                { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }

        try {
            const body = await request.json();
            const rawQuery = typeof body.query === 'string' ? body.query.trim() : '';
            if (!rawQuery) {
                return new Response(
                    JSON.stringify({ error: "Query parameter is required and must be a non-empty string" }),
                    { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
                );
            }
            const page = Math.max(1, Math.floor(Number(body.page) || 1));
            const pageSize = Math.min(100, Math.max(1, Math.floor(Number(body.pageSize) || 60)));
            const { minPrice, maxPrice, sortBy } = body;

            // ═══ QUERY OPTIMIZATION - Remove filler words, extract key terms ═══
            const words = rawQuery.toLowerCase().trim().split(/\s+/).filter((w: string) => w.length > 1 && !FILLER_WORDS.has(w)).slice(0, 4);
            const query = words.length > 0 ? words.join(' ') : rawQuery;

            // Log query diagnostics; all user-derived text is gated behind
            // SEARCH_DEBUG to avoid leaking PII into production logs.
            const SEARCH_DEBUG = process.env.SEARCH_DEBUG === "true";
            if (SEARCH_DEBUG) {
                console.log(`[Search] rawQuery="${rawQuery}" → optimized="${query}" (${words.length} words kept)`);
            } else {
                console.log(`[Search] queryWordsKept=${words.length}`);
            }

            // Optional synonym query for backfill only
            const synQuery = words.map((w: string) => SYNONYMS[w] || w).join(' ');
            const hasSynonym = synQuery !== query;

            // Each query fetches exactly 1 upstream page at the correct offset
            const frameOffset = Math.max(0, page - 1) * pageSize;
            console.log(`[Search] page=${page}, pageSize=${pageSize}, offset=${frameOffset}, hasSynonym=${hasSynonym}`);

            const errors: string[] = [];
            let upstreamTotalCount = 0;

            // Helper to fetch with timeout
            const fetchWithTimeout = async (url: string, timeoutMs = 20000) => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), timeoutMs);
                if (SEARCH_DEBUG) {
                    console.log(`[Search Debug] Fetching upstream endpoint: BatchSearchItemsFrame`);
                }
                const fetchStart = Date.now();
                try {
                    const response = await fetch(url, {
                        method: "GET",
                        headers: {
                            "X-RapidAPI-Key": rapidApiKey,
                            "x-rapidapi-host": RAPIDAPI_HOST,
                        },
                        signal: controller.signal,
                    });
                    clearTimeout(timeout);
                    const elapsed = Date.now() - fetchStart;
                    if (SEARCH_DEBUG) {
                        console.log(`[Search Debug] Upstream response: status=${response.status}, time=${elapsed}ms`);
                    }
                    if (!response.ok) {
                        const errorBody = await response.text();
                        console.error(`[Search Debug] Upstream error: status=${response.status}, bodyLength=${errorBody.length}`);
                        throw new Error(`UPSTREAM_HTTP_${response.status}`);
                    }
                    const data = await response.json();
                    if (SEARCH_DEBUG) {
                        console.log(`[Search Debug] Upstream JSON keys: ${Object.keys(data).join(', ')}, ErrorCode: ${data.ErrorCode || 'N/A'}`);
                    }
                    if (data?.ErrorCode !== 'Ok' || data?.Result?.HasError) {
                        throw new Error(data?.Result?.ErrorCode || data?.ErrorCode || 'UPSTREAM_INVALID_PAYLOAD');
                    }
                    return data;
                } catch (e: any) {
                    clearTimeout(timeout);
                    const elapsed = Date.now() - fetchStart;
                    const isTimeout = e?.name === 'AbortError';
                    console.error(`[Search Debug] Fetch failed after ${elapsed}ms: ${isTimeout ? 'TIMEOUT' : (e?.message || 'UNKNOWN_ERROR')}`);
                    throw e;
                }
            };

            const usdToCny = parseFloat(process.env.USD_CNY_RATE || '7.2') || 7.2;

            // Build params helper
            const buildParams = (q: string) => {
                const params = new URLSearchParams({
                    language: 'en',
                    framePosition: String(frameOffset),
                    frameSize: String(pageSize),
                    ItemTitle: q,
                    OrderBy: mapSortOrder(sortBy),
                });
                if (minPrice) {
                    const parsed = parseFloat(minPrice);
                    if (Number.isFinite(parsed)) params.append("MinPrice", String(Math.round(parsed * usdToCny)));
                }
                if (maxPrice) {
                    const parsed = parseFloat(maxPrice);
                    if (Number.isFinite(parsed)) params.append("MaxPrice", String(Math.round(parsed * usdToCny)));
                }
                return params;
            };

            // 1. Fetch primary query
            let primaryResults: NormalizedProduct[] = [];
            try {
                const data = await fetchWithTimeout(
                    `https://${RAPIDAPI_HOST}/BatchSearchItemsFrame?${buildParams(query)}`
                );
                const { products, totalCount } = normalizeOtapi1688(data);
                primaryResults = products;
                upstreamTotalCount = totalCount;
                console.log(`[Search] Primary results: ${products.length} products, totalCount: ${totalCount}`);
            } catch (e: any) {
                console.error(`[Search] OTAPI primary fetch FAILED: ${e.message}`);
                errors.push(`1688: ${e.message}`);
            }

            // 2. Deduplicate primary results
            const seen = new Set<string>();
            const uniqueResults = primaryResults.filter(p => {
                if (seen.has(p.id)) return false;
                seen.add(p.id);
                return true;
            });

            // 3. If primary under-fills, backfill from synonym query
            if (hasSynonym && uniqueResults.length < pageSize) {
                try {
                    const synData = await fetchWithTimeout(
                        `https://${RAPIDAPI_HOST}/BatchSearchItemsFrame?${buildParams(synQuery)}`
                    );
                    const { products: synProducts } = normalizeOtapi1688(synData);
                    // Only add items we haven't seen, up to pageSize
                    for (const p of synProducts) {
                        if (uniqueResults.length >= pageSize) break;
                        if (!seen.has(p.id)) {
                            seen.add(p.id);
                            uniqueResults.push(p);
                        }
                    }
                } catch (e: any) {
                    console.error(`[Search] OTAPI synonym backfill failed: ${e.message}`);
                }
            }

            // Sort based on client preference
            if (sortBy === 'price_asc') uniqueResults.sort((a, b) => a.price - b.price);
            else if (sortBy === 'price_desc') uniqueResults.sort((a, b) => b.price - a.price);

            // Cap results to requested pageSize
            const pagedResults = uniqueResults.slice(0, pageSize);

            return new Response(
                JSON.stringify({
                    products: pagedResults,
                    totalCount: upstreamTotalCount || pagedResults.length,
                    currentPage: page,
                    totalPages: upstreamTotalCount > 0 ? Math.ceil(upstreamTotalCount / pageSize) : 1,
                    hasMore: upstreamTotalCount > page * pageSize,
                    sources: ['1688'],
                    queriesUsed: hasSynonym ? [query, synQuery] : [query],
                    errors: errors.length > 0 ? errors : undefined,
                }),
                { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        } catch (error: any) {
            console.error("Aggregated search error:", error);
            const isTimeout = error?.name === 'AbortError';
            return new Response(
                JSON.stringify({ error: isTimeout ? 'Upstream request timed out' : (error.message || 'Search failed') }),
                { status: isTimeout ? 504 : 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }
    }),
});

// CORS preflight for aggregated search
http.route({
    path: "/products/search",
    method: "OPTIONS",
    handler: httpAction(async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
    }),
});

export default http;

