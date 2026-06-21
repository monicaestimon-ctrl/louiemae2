import React, { useState } from 'react';
import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Id } from '../convex/_generated/dataModel';
import { Package, Truck, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, MapPin, Mail, RefreshCw, ExternalLink, AlertTriangle, Loader2 } from 'lucide-react';

type OrderStatus = 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
type CjStatus = 'pending' | 'sending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'failed' | 'cancelled';

interface OrderItem {
    name: string;
    quantity: number;
    price: number;
    cjVariantId?: string;
    cjSku?: string;
}

const statusConfig: Record<OrderStatus, { label: string; color: string; icon: React.ReactNode }> = {
    pending: { label: 'Pending', color: 'bg-amber-900/30 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(251,191,36,0.15)]', icon: <Clock className="w-4 h-4" /> },
    paid: { label: 'Paid', color: 'bg-green-900/40 text-green-400 border border-green-500/30 shadow-[0_0_10px_rgba(74,222,128,0.15)] glow-text', icon: <CheckCircle className="w-4 h-4 drop-shadow-[0_0_3px_currentColor]" /> },
    processing: { label: 'Processing', color: 'bg-blue-900/40 text-blue-400 border border-blue-500/30 shadow-[0_0_10px_rgba(96,165,250,0.15)]', icon: <Package className="w-4 h-4" /> },
    shipped: { label: 'Shipped', color: 'bg-purple-900/40 text-purple-400 border border-purple-500/30 shadow-[0_0_10px_rgba(192,132,252,0.15)]', icon: <Truck className="w-4 h-4 drop-shadow-[0_0_3px_currentColor]" /> },
    delivered: { label: 'Delivered', color: 'bg-emerald-900/40 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.15)] glow-text', icon: <CheckCircle className="w-4 h-4 drop-shadow-[0_0_3px_currentColor]" /> },
    cancelled: { label: 'Cancelled', color: 'bg-red-900/40 text-red-400 border border-red-500/30 shadow-[0_0_10px_rgba(248,113,113,0.15)]', icon: <XCircle className="w-4 h-4 drop-shadow-[0_0_3px_currentColor]" /> },
};

const cjStatusConfig: Record<CjStatus, { label: string; color: string; icon: React.ReactNode }> = {
    pending: { label: 'CJ Pending', color: 'bg-white/10 text-cream/80 border border-white/20', icon: <Clock className="w-3 h-3" /> },
    sending: { label: 'Sending to CJ', color: 'bg-blue-900/30 text-blue-300 border border-blue-500/20', icon: <RefreshCw className="w-3 h-3 animate-spin drop-shadow-[0_0_3px_currentColor]" /> },
    confirmed: { label: 'CJ Confirmed', color: 'bg-green-900/30 text-green-300 border border-green-500/20', icon: <CheckCircle className="w-3 h-3 drop-shadow-[0_0_3px_currentColor]" /> },
    processing: { label: 'CJ Processing', color: 'bg-blue-900/30 text-blue-300 border border-blue-500/20', icon: <Package className="w-3 h-3" /> },
    shipped: { label: 'CJ Shipped', color: 'bg-purple-900/30 text-purple-300 border border-purple-500/20', icon: <Truck className="w-3 h-3 drop-shadow-[0_0_3px_currentColor]" /> },
    delivered: { label: 'CJ Delivered', color: 'bg-emerald-900/30 text-emerald-300 border border-emerald-500/20', icon: <CheckCircle className="w-3 h-3 drop-shadow-[0_0_3px_currentColor]" /> },
    failed: { label: 'CJ Failed', color: 'bg-red-900/30 text-red-400 border border-red-500/30 shadow-[inset_0_0_10px_rgba(248,113,113,0.2)]', icon: <XCircle className="w-3 h-3 drop-shadow-[0_0_3px_currentColor]" /> },
    cancelled: { label: 'CJ Cancelled', color: 'bg-white/5 text-cream/40 border border-white/10', icon: <XCircle className="w-3 h-3" /> },
};

export const AdminOrders: React.FC = () => {
    const orders = useQuery(api.orders.getAll) || [];
    const updateStatus = useMutation(api.orders.updateStatus);
    const resetCjStatus = useMutation(api.orders.resetCjStatus);
    const syncTracking = useAction(api.cjActions.syncTracking);
    const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all' | 'cj-failed'>('all');
    const [retryingOrder, setRetryingOrder] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ synced: number; errors: number } | null>(null);

    const filteredOrders = filterStatus === 'all'
        ? orders
        : filterStatus === 'cj-failed'
            ? orders.filter(o => o.cjStatus === 'failed')
            : orders.filter(o => o.status === filterStatus);

    const handleStatusChange = async (orderId: Id<"orders">, newStatus: OrderStatus) => {
        await updateStatus({ orderId, status: newStatus });
    };

    const handleRetryCj = async (orderId: Id<"orders">) => {
        setRetryingOrder(orderId);
        try {
            await resetCjStatus({ orderId });
            // The CJ order will be resent on the next sync or manually triggered
        } finally {
            setRetryingOrder(null);
        }
    };

    const handleSyncTracking = async () => {
        setIsSyncing(true);
        setSyncResult(null);
        try {
            const result = await syncTracking({});
            setSyncResult(result);
            // Clear result after 5 seconds
            setTimeout(() => setSyncResult(null), 5000);
        } catch (error) {
            console.error('Sync failed:', error);
        } finally {
            setIsSyncing(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Count CJ failed orders
    const cjFailedCount = orders.filter(o => o.cjStatus === 'failed').length;

    return (
        <div className="p-2 md:p-8 animate-fade-in-up">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 bg-white/5 backdrop-blur-3xl p-6 rounded-[2rem] border border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.2)] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-bronze/10 rounded-bl-full -mr-16 -mt-16 blur-2xl pointer-events-none"></div>
                <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-[2rem] mix-blend-overlay"></div>
                
                <div className="relative z-10 flex flex-col items-start gap-1">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-amber-400 font-medium flex items-center gap-2 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]">
                        <span className="w-6 h-px bg-amber-400/50 shadow-[#FBBF24]"></span>
                        Fulfillment Center
                    </span>
                    <h2 className="font-serif text-3xl md:text-4xl text-cream drop-shadow-md tracking-tight">Orders</h2>
                    <p className="text-cream/60 text-sm font-light mt-1 flex items-center gap-2">
                        {orders.length} total orders <span className="w-1 h-1 rounded-full bg-cream/30"></span> Ready for processing
                    </p>
                </div>

                {/* Filter */}
                <div className="flex flex-wrap items-center gap-3 relative z-10">
                    {cjFailedCount > 0 && (
                        <span className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-300 text-xs uppercase tracking-widest font-medium rounded-full flex items-center gap-2 shadow-[0_0_15px_rgba(239,68,68,0.2)] backdrop-blur-md">
                            <AlertTriangle className="w-4 h-4 drop-shadow-[0_0_3px_currentColor]" />
                            {cjFailedCount} CJ Failed
                        </span>
                    )}
                    <div className="relative">
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value as OrderStatus | 'all' | 'cj-failed')}
                            className="pl-5 pr-10 py-3 bg-black/40 border border-white/10 rounded-xl text-sm text-cream hover:border-white/30 focus:outline-none focus:border-bronze focus:bg-black/60 transition-all shadow-inner appearance-none cursor-pointer"
                        >
                            <option value="all" className="bg-[#120D09]">All Orders</option>
                            <option value="paid" className="bg-[#120D09]">Paid</option>
                            <option value="processing" className="bg-[#120D09]">Processing</option>
                            <option value="shipped" className="bg-[#120D09]">Shipped</option>
                            <option value="delivered" className="bg-[#120D09]">Delivered</option>
                            <option value="cancelled" className="bg-[#120D09]">Cancelled</option>
                            {cjFailedCount > 0 && <option value="cj-failed" className="bg-[#120D09]">⚠️ CJ Failed ({cjFailedCount})</option>}
                        </select>
                        <ChevronDown className="w-4 h-4 text-cream/40 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    {/* Sync Tracking Button */}
                    <button
                        onClick={handleSyncTracking}
                        disabled={isSyncing}
                        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-bronze/20 to-bronze/5 border border-bronze/30 text-amber-400 rounded-xl hover:bg-bronze/20 hover:border-amber-400/50 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm uppercase tracking-widest font-medium shadow-[0_0_15px_rgba(193,154,107,0.2)]"
                    >
                        {isSyncing ? (
                            <Loader2 className="w-4 h-4 animate-spin drop-shadow-[0_0_3px_currentColor]" />
                        ) : (
                            <RefreshCw className="w-4 h-4 drop-shadow-[0_0_3px_currentColor]" />
                        )}
                        {isSyncing ? 'Syncing...' : 'Sync Tracking'}
                    </button>

                    {/* Sync Result Toast */}
                    {syncResult && (
                        <span className="px-4 py-2 bg-green-500/20 border border-green-500/30 text-green-300 text-xs font-medium uppercase tracking-widest rounded-full animate-fade-in flex items-center gap-2 shadow-[0_0_10px_rgba(34,197,94,0.2)] backdrop-blur-md">
                            <CheckCircle className="w-4 h-4 drop-shadow-[0_0_3px_currentColor]" /> 
                            Synced {syncResult.synced}
                            {syncResult.errors > 0 && ` / ${syncResult.errors} errors`}
                        </span>
                    )}
                </div>
            </div>

            {/* Orders List */}
            {filteredOrders.length === 0 ? (
                <div className="text-center py-24 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-md shadow-inner flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/20 to-black/40 pointer-events-none"></div>
                    <div className="p-6 bg-black/40 rounded-full border border-white/10 shadow-inner mb-6 relative z-10 group-hover:scale-110 transition-transform">
                        <Package className="w-12 h-12 text-cream/20 drop-shadow-[0_0_5px_currentColor]" />
                    </div>
                    <p className="font-serif text-2xl text-cream/50 relative z-10 tracking-wide drop-shadow-sm">No orders found.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {filteredOrders.map((order) => {
                        const isExpanded = expandedOrder === order._id;
                        const status = statusConfig[order.status as OrderStatus] || statusConfig.pending;
                        const cjStatus = order.cjStatus ? cjStatusConfig[order.cjStatus as CjStatus] : null;
                        const hasCjProducts = order.items?.some((item: OrderItem) => item.cjVariantId || item.cjSku);

                        return (
                            <div key={order._id} className={`group bg-black/40 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl transition-all duration-500 hover:bg-white/5 hover:border-white/20 shadow-[0_10px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_15px_30px_rgba(0,0,0,0.5)] ${order.cjStatus === 'failed' ? 'shadow-[0_0_15px_rgba(239,68,68,0.2)] border-red-500/30' : ''}`}>
                                {/* Inner Glow Border */}
                                <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-2xl mix-blend-overlay z-50"></div>

                                {/* Order Header */}
                                <div
                                    className="p-4 md:p-6 flex flex-col md:flex-row md:items-center justify-between cursor-pointer gap-4 md:gap-0 relative z-10"
                                    onClick={() => setExpandedOrder(isExpanded ? null : order._id)}
                                >
                                    <div className="flex items-center gap-4 md:gap-8 min-w-0">
                                        <div className="p-3 bg-white/5 border border-white/10 rounded-xl hidden md:block group-hover:bg-white/10 transition-colors shadow-inner">
                                            <Package className={`w-5 h-5 ${isExpanded ? 'text-amber-400 drop-shadow-[0_0_5px_currentColor]' : 'text-cream/40'} transition-colors`} />
                                        </div>
                                        <div>
                                            <p className="font-mono text-base text-cream font-medium tracking-wider drop-shadow-sm group-hover:text-amber-400 transition-colors">
                                                #{order.stripeSessionId.slice(-8).toUpperCase()}
                                            </p>
                                            <p className="text-[11px] uppercase tracking-widest text-cream/40 mt-1">{formatDate(order.createdAt)}</p>
                                        </div>
                                        <div className="hidden md:flex items-center gap-2 text-sm text-cream/60 min-w-0 bg-black/40 px-4 py-2 rounded-full border border-white/5 shadow-inner">
                                            <Mail className="w-4 h-4 flex-shrink-0 text-bronze" />
                                            <span className="truncate">{order.customerEmail}</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3 md:gap-4">
                                        <span className="font-serif text-xl md:text-2xl text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)] min-w-[5rem] text-right">
                                            ${order.total.toFixed(2)}
                                        </span>
                                        
                                        <div className="h-8 w-px bg-white/10 hidden md:block"></div>

                                        {/* CJ Status Badge */}
                                        {cjStatus && (
                                            <span className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-medium flex items-center gap-1.5 ${cjStatus.color}`}>
                                                {cjStatus.icon}
                                                {cjStatus.label}
                                            </span>
                                        )}

                                        {/* Order Status Badge */}
                                        <span className={`px-4 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-medium flex items-center gap-1.5 ${status.color}`}>
                                            {status.icon}
                                            {status.label}
                                        </span>
                                        
                                        <div className={`p-2 rounded-full transition-colors ${isExpanded ? 'bg-white/10 text-cream' : 'bg-transparent text-cream/30 group-hover:text-cream/70 hover:bg-white/5'}`}>
                                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Details */}
                                {isExpanded && (
                                    <div className="border-t border-white/10 p-5 md:p-8 bg-black/60 shadow-inner rounded-b-2xl relative">
                                        <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-b-2xl pointer-events-none"></div>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-10 relative z-10">
                                            {/* Items */}
                                            <div className="md:col-span-2 space-y-4">
                                                <h4 className="text-[10px] uppercase tracking-[0.2em] text-amber-400/80 mb-2 glow-text flex items-center gap-2">
                                                    <Package className="w-3 h-3" /> Purchased Items
                                                </h4>
                                                <div className="space-y-3 bg-white/5 p-4 rounded-xl border border-white/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
                                                    {order.items.map((item: OrderItem, idx: number) => (
                                                        <div key={idx} className="flex justify-between text-sm py-2 border-b border-white/5 last:border-0 last:pb-0">
                                                            <div className="flex flex-col">
                                                                <span className="text-cream font-medium tracking-wide">
                                                                    {item.name} <span className="text-cream/40 px-2 text-xs">× {item.quantity}</span>
                                                                </span>
                                                                {(item.cjVariantId || item.cjSku) && (
                                                                    <span className="text-[10px] uppercase tracking-widest text-[#B26EEB] flex items-center gap-1 mt-1 drop-shadow-[0_0_5px_rgba(178,110,235,0.4)]">
                                                                        <Truck className="w-2.5 h-2.5" /> CJ Dropshipped
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="text-cream/70 font-mono tracking-wider">${(item.price * item.quantity).toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                    <div className="border-t border-white/10 pt-4 mt-2">
                                                        <div className="flex justify-between text-xs tracking-wider uppercase mb-2">
                                                            <span className="text-cream/40">Subtotal</span>
                                                            <span className="text-cream/70 font-mono">${order.subtotal.toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between text-xs tracking-wider uppercase mb-3">
                                                            <span className="text-cream/40">Shipping</span>
                                                            <span className="text-cream/70 font-mono">${(order.shipping || 0).toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between items-center text-sm font-medium pt-3 border-t border-white/10">
                                                            <span className="uppercase tracking-[0.2em] text-cream">Total</span>
                                                            <span className="text-xl font-serif text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]">${order.total.toFixed(2)}</span>
                                                        </div>
                                                    </div>
                                                    {(order.cjQuotedLandedCost !== undefined || order.cjPricingWarnings?.length) && (
                                                        <div className="border-t border-white/10 pt-4 mt-4 space-y-2">
                                                            <div className="flex justify-between text-xs tracking-wider uppercase">
                                                                <span className="text-cream/40">CJ Product Cost</span>
                                                                <span className="text-cream/70 font-mono">${(order.cjQuotedProductCost || 0).toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs tracking-wider uppercase">
                                                                <span className="text-cream/40">CJ Freight</span>
                                                                <span className="text-cream/70 font-mono">${(order.cjQuotedShippingCost || 0).toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs tracking-wider uppercase">
                                                                <span className="text-cream/40">CJ Fees/Tax</span>
                                                                <span className="text-cream/70 font-mono">${((order.cjQuotedTaxesFee || 0) + (order.cjQuotedClearanceFee || 0)).toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs tracking-wider uppercase">
                                                                <span className="text-cream/40">CJ Landed</span>
                                                                <span className="text-cream/70 font-mono">${(order.cjQuotedLandedCost || 0).toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs tracking-wider uppercase">
                                                                <span className="text-cream/40">Customer Shipping</span>
                                                                <span className="text-cream/70 font-mono">${(order.cjCustomerShippingCollected || 0).toFixed(2)}</span>
                                                            </div>
                                                            <div className="flex justify-between text-xs tracking-wider uppercase">
                                                                <span className="text-cream/40">Est. Profit</span>
                                                                <span className={`font-mono ${(order.cjEstimatedProfit || 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>${(order.cjEstimatedProfit || 0).toFixed(2)}</span>
                                                            </div>
                                                            {order.cjQuotedLogisticsName && (
                                                                <p className="text-[10px] uppercase tracking-widest text-cream/40">Logistics: {order.cjQuotedLogisticsName}</p>
                                                            )}
                                                            {order.cjPricingWarnings?.map((warning: string, index: number) => (
                                                                <p key={`${warning}-${index}`} className="text-[11px] text-amber-300 flex items-start gap-2">
                                                                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                                                    <span>{warning}</span>
                                                                </p>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Side Meta column */}
                                            <div className="space-y-8 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8 relative">
                                                {/* Shipping Address */}
                                                <div>
                                                    <h4 className="text-[10px] uppercase tracking-[0.2em] text-amber-400/80 mb-4 glow-text flex items-center gap-2">
                                                        <MapPin className="w-3 h-3" /> Shipping Target
                                                    </h4>
                                                    {order.shippingAddress ? (
                                                        <div className="text-sm text-cream/80 bg-white/5 p-4 rounded-xl border border-white/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] leading-relaxed font-light">
                                                            <p className="font-medium text-cream tracking-wide mb-1 flex items-center gap-2">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-bronze"></span> 
                                                                {order.customerName}
                                                            </p>
                                                            <p>{order.shippingAddress.line1}</p>
                                                            {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
                                                            <p className="mt-1">{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}</p>
                                                            <p className="text-cream/40 mt-1 uppercase text-xs tracking-widest">{order.shippingAddress.country}</p>
                                                        </div>
                                                    ) : (
                                                        <div className="text-sm text-center py-4 text-cream/30 bg-white/5 border border-white/5 rounded-xl border-dashed">No address provided</div>
                                                    )}
                                                </div>

                                                {/* CJ Fulfillment & Actions */}
                                                <div className="space-y-6">
                                                    <div>
                                                        <h4 className="text-[10px] uppercase tracking-[0.2em] text-amber-400/80 mb-4 glow-text flex items-center gap-2">
                                                            <RefreshCw className="w-3 h-3" /> Update Status
                                                        </h4>
                                                        <div className="relative group">
                                                            <select
                                                                value={order.status}
                                                                onChange={(e) => handleStatusChange(order._id as Id<"orders">, e.target.value as OrderStatus)}
                                                                className="w-full pl-4 pr-10 py-3 bg-black/40 border border-white/10 rounded-xl text-sm text-cream hover:border-white/30 focus:outline-none focus:border-bronze focus:bg-black/60 transition-all shadow-inner appearance-none cursor-pointer focus:ring-1 focus:ring-bronze/50"
                                                            >
                                                                <option value="paid" className="bg-[#120D09]">Paid</option>
                                                                <option value="processing" className="bg-[#120D09]">Processing</option>
                                                                <option value="shipped" className="bg-[#120D09]">Shipped</option>
                                                                <option value="delivered" className="bg-[#120D09]">Delivered</option>
                                                                <option value="cancelled" className="bg-[#120D09]">Cancelled</option>
                                                            </select>
                                                            <ChevronDown className="w-4 h-4 text-cream/40 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-colors group-hover:text-cream/70" />
                                                        </div>
                                                    </div>

                                                    {hasCjProducts && (
                                                        <div className="pt-2">
                                                            <h4 className="text-[10px] uppercase tracking-[0.2em] text-[#B26EEB] mb-3 drop-shadow-[0_0_5px_rgba(178,110,235,0.4)] flex items-center gap-2">
                                                                <ExternalLink className="w-3 h-3" /> CJ Link
                                                            </h4>
                                                            <div className="space-y-3 bg-black/40 p-4 rounded-xl border border-white/5 shadow-inner">
                                                                {order.cjOrderId && (
                                                                    <div className="text-xs flex items-center justify-between border-b border-white/5 pb-2">
                                                                        <span className="text-cream/40 uppercase tracking-widest">Order ID:</span>
                                                                        <span className="font-mono text-cream/90 select-all">{order.cjOrderId}</span>
                                                                    </div>
                                                                )}

                                                                {(order.trackingNumber || order.carrier) && (
                                                                    <div className="text-xs pt-1 space-y-2">
                                                                        {order.carrier && (
                                                                            <div className="flex justify-between items-center">
                                                                                <span className="text-cream/40 uppercase tracking-widest">Carrier:</span>
                                                                                <span className="text-cream/80">{order.carrier}</span>
                                                                            </div>
                                                                        )}
                                                                        {order.trackingNumber && (
                                                                            <div className="flex justify-between items-center">
                                                                                <span className="text-cream/40 uppercase tracking-widest">Tracking:</span>
                                                                                {order.trackingUrl ? (
                                                                                    <a
                                                                                        href={order.trackingUrl}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        className="font-mono text-[#B26EEB] hover:text-white px-2 py-1 bg-white/5 rounded border border-[#B26EEB]/30 hover:bg-[#B26EEB]/20 transition-all inline-flex items-center gap-1.5 shadow-[0_0_10px_rgba(178,110,235,0.1)]"
                                                                                    >
                                                                                        {order.trackingNumber}
                                                                                        <ExternalLink className="w-2.5 h-2.5" />
                                                                                    </a>
                                                                                ) : (
                                                                                    <span className="font-mono text-cream/90 bg-white/5 px-2 py-1 rounded select-all">{order.trackingNumber}</span>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {order.cjError && (
                                                                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs tracking-wide text-red-300 leading-relaxed shadow-inner font-mono">
                                                                        <strong className="uppercase text-red-400 block mb-1">CJDropshipping Error:</strong> 
                                                                        {order.cjError}
                                                                    </div>
                                                                )}

                                                                {order.cjStatus === 'failed' && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleRetryCj(order._id as Id<"orders">); }}
                                                                        disabled={retryingOrder === order._id}
                                                                        className="mt-4 w-full px-4 py-2.5 bg-gradient-to-r from-red-500/20 to-red-600/20 border border-red-500/30 text-red-300 hover:text-red-200 text-xs font-medium uppercase tracking-widest rounded-lg hover:from-red-500/30 hover:to-red-600/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                                                                    >
                                                                        <RefreshCw className={`w-3.5 h-3.5 mt-[-1px] ${retryingOrder === order._id ? 'animate-spin drop-shadow-[0_0_3px_currentColor]' : ''}`} />
                                                                        Retry CJ Payload
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default AdminOrders;
