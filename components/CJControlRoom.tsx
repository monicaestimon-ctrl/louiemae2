import React, { useMemo, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Id } from '../convex/_generated/dataModel';
import {
    AlertTriangle,
    ArrowUpRight,
    CheckCircle2,
    ClipboardCheck,
    Clock3,
    ExternalLink,
    FileText,
    Loader2,
    PackageCheck,
    RefreshCw,
    RotateCcw,
    ShieldCheck,
    Truck,
    WalletCards,
    XCircle,
} from 'lucide-react';

type FilterKey =
    | 'all'
    | 'needs_review'
    | 'ready_for_cj'
    | 'waiting_for_payment'
    | 'waiting_for_tracking'
    | 'in_transit'
    | 'delivered'
    | 'failed_or_stuck';

type RiskSeverity = 'critical' | 'warning' | 'info';
type RiskType =
    | 'automation'
    | 'mapping'
    | 'shipping'
    | 'fulfillment'
    | 'payment'
    | 'tracking'
    | 'inventory'
    | 'notification'
    | 'refund'
    | 'pricing';

type ControlRisk = {
    key: string;
    type: RiskType;
    severity: RiskSeverity;
    title: string;
    description: string;
    nextAction: string;
    actionKey: string;
    orderId?: string;
    productId?: string;
    createdAt: string;
    reviewed?: {
        reviewedAt: string;
        note?: string;
        actorEmail?: string;
    };
};

type ControlOrder = {
    orderId?: string;
    customerName: string;
    customerEmail: string;
    total: number;
    currency: string;
    status: string;
    pipelineState: string;
    pipelineLabel: string;
    pipelineRank: number;
    needsReview: boolean;
    nextAction: string;
    nextActionKey: string;
    cjOrderId?: string;
    cjParentOrderId?: string;
    cjPaymentStatus?: string;
    cjFulfillmentStep?: string;
    cjStatus?: string;
    cjError?: string;
    cjPaymentUrl?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    carrier?: string;
    cjTrackingStatus?: string;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string;
    risks: ControlRisk[];
};

type AuditRecord = {
    _id: string;
    actionType: 'risk_reviewed' | 'note_added';
    title?: string;
    note?: string;
    actorEmail: string;
    createdAt: string;
    reviewedAt?: string;
};

const FILTERS: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'needs_review', label: 'Needs review' },
    { key: 'ready_for_cj', label: 'Ready' },
    { key: 'waiting_for_payment', label: 'Payment' },
    { key: 'waiting_for_tracking', label: 'Tracking' },
    { key: 'in_transit', label: 'In transit' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'failed_or_stuck', label: 'Stuck' },
];

const severityClasses: Record<RiskSeverity, string> = {
    critical: 'border-red-400/30 bg-red-500/10 text-red-200',
    warning: 'border-amber-300/30 bg-amber-400/10 text-amber-100',
    info: 'border-white/15 bg-white/5 text-cream/70',
};

const pipelineClasses: Record<string, string> = {
    needs_review: 'border-red-400/30 bg-red-500/10 text-red-200',
    waiting_for_cj_payment: 'border-amber-300/30 bg-amber-400/10 text-amber-100',
    waiting_for_tracking: 'border-blue-300/25 bg-blue-400/10 text-blue-100',
    in_transit: 'border-purple-300/25 bg-purple-400/10 text-purple-100',
    delivered: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100',
    ready_for_cj: 'border-bronze/40 bg-bronze/10 text-amber-100',
};

const formatMoney = (amount: number, currency: string) => {
    const normalizedCurrency = currency?.trim().toUpperCase();
    const safeCurrency = /^[A-Z]{3}$/.test(normalizedCurrency || '') ? normalizedCurrency : 'USD';

    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: safeCurrency,
        }).format(amount);
    } catch {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount);
    }
};

const formatDate = (value?: string) => {
    if (!value) return 'Not recorded';
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(value));
};

const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

const asOrderId = (value: string | undefined) => value as Id<'orders'> | undefined;
const asProductId = (value: string | undefined) => value as Id<'products'> | undefined;

export const CJControlRoom: React.FC = () => {
    const [filter, setFilter] = useState<FilterKey>('needs_review');
    const [selectedOrderId, setSelectedOrderId] = useState<Id<'orders'> | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [toast, setToast] = useState<{ success: boolean; message: string } | null>(null);

    const overview = useQuery(api.cjControlRoom.getOverview);
    const orders = useQuery(api.cjControlRoom.getOrders, { filter, limit: 75 }) as ControlOrder[] | undefined;
    const effectiveOrderId = selectedOrderId || asOrderId(orders?.[0]?.orderId) || null;
    const selectedOrder = useQuery(
        api.cjControlRoom.getOrderDetail,
        effectiveOrderId ? { orderId: effectiveOrderId, includeReviewed: true } : 'skip',
    ) as ControlOrder | null | undefined;
    const audits = useQuery(
        api.cjFulfillmentAudits.getForOrder,
        effectiveOrderId ? { orderId: effectiveOrderId } : 'skip',
    ) as AuditRecord[] | undefined;

    const syncTracking = useAction(api.cjActions.syncTracking);
    const syncOrderTracking = useAction(api.cjActions.syncOrderTracking);
    const retryOrderFulfillment = useAction(api.cjActions.retryOrderFulfillment);
    const refreshInventory = useAction(api.cjActions.refreshInventory);
    const markRiskReviewed = useMutation(api.cjFulfillmentAudits.markRiskReviewed);
    const addFulfillmentNote = useMutation(api.cjFulfillmentAudits.addFulfillmentNote);

    const currentOrder = selectedOrder || orders?.find(order => order.orderId === effectiveOrderId) || orders?.[0] || null;
    const summary = overview?.summary;
    const automation = overview?.automation;

    const orderedRisks = useMemo(() => currentOrder?.risks || [], [currentOrder]);

    const runWithToast = async (key: string, action: () => Promise<string>) => {
        setBusyKey(key);
        setToast(null);
        try {
            const message = await action();
            setToast({ success: true, message });
        } catch (error) {
            setToast({ success: false, message: getErrorMessage(error, 'Action failed') });
        } finally {
            setBusyKey(null);
        }
    };

    const handleRetryOrder = (orderId?: string) => {
        const id = asOrderId(orderId);
        if (!id) return;
        void runWithToast(`retry-${id}`, async () => {
            const result = await retryOrderFulfillment({ orderId: id });
            if (!result.success) throw new Error(result.message || result.error || 'CJ retry failed');
            return result.message || 'CJ retry submitted';
        });
    };

    const handleSyncOrder = (orderId?: string) => {
        const id = asOrderId(orderId);
        if (!id) return;
        void runWithToast(`sync-${id}`, async () => {
            const result = await syncOrderTracking({ orderId: id });
            if (!result.success) throw new Error(result.message || result.error || 'Tracking sync failed');
            return result.message || 'Tracking synced';
        });
    };

    const handleSyncAll = () => {
        void runWithToast('sync-all', async () => {
            const result = await syncTracking({});
            return `Synced ${result.synced} orders${result.errors ? `, ${result.errors} errors` : ''}`;
        });
    };

    const handleRefreshInventory = () => {
        void runWithToast('refresh-inventory', async () => {
            const result = await refreshInventory({});
            return `Inventory refreshed for ${result.updated}/${result.checked} products${result.errors ? `, ${result.errors} errors` : ''}`;
        });
    };

    const handleMarkReviewed = (risk: ControlRisk) => {
        void runWithToast(`review-${risk.key}`, async () => {
            await markRiskReviewed({
                riskKey: risk.key,
                riskType: risk.type,
                severity: risk.severity,
                title: risk.title,
                orderId: asOrderId(risk.orderId),
                productId: asProductId(risk.productId),
            });
            return 'Risk marked reviewed';
        });
    };

    const handleAddNote = () => {
        if (!effectiveOrderId || !note.trim()) return;
        void runWithToast('add-note', async () => {
            await addFulfillmentNote({ orderId: effectiveOrderId, note: note.trim() });
            setNote('');
            return 'Note added';
        });
    };

    const metricCards = [
        {
            label: 'Needs review',
            value: summary?.needsReview ?? 0,
            Icon: AlertTriangle,
            tone: 'text-red-200',
            subtext: 'Clear these first',
        },
        {
            label: 'CJ payment',
            value: summary?.waitingForPayment ?? 0,
            Icon: WalletCards,
            tone: 'text-amber-100',
            subtext: 'Waiting to be paid',
        },
        {
            label: 'Tracking',
            value: summary?.waitingForTracking ?? 0,
            Icon: Clock3,
            tone: 'text-blue-100',
            subtext: 'Paid, not moving yet',
        },
        {
            label: 'In transit',
            value: summary?.inTransit ?? 0,
            Icon: Truck,
            tone: 'text-purple-100',
            subtext: 'On the way',
        },
    ];

    return (
        <div className="p-2 md:p-8 animate-fade-in-up">
            <div className="relative mb-8 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-3xl">
                <div className="absolute right-0 top-0 h-56 w-56 rounded-bl-full bg-bronze/10 blur-3xl" />
                <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <span className="mb-3 flex items-center gap-3 text-[10px] uppercase tracking-[0.35em] text-bronze">
                            <span className="h-px w-8 bg-bronze/60" />
                            Hands-off fulfillment
                        </span>
                        <h1 className="font-serif text-3xl text-cream drop-shadow-md md:text-5xl">CJ Control Room</h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-cream/60">
                            Track every CJ order from paid checkout to delivery, with safe actions for the next step.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={handleSyncAll}
                            disabled={busyKey === 'sync-all'}
                            className="inline-flex items-center gap-2 rounded-xl border border-bronze/30 bg-bronze/15 px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-amber-100 transition hover:border-bronze/60 hover:bg-bronze/20 disabled:opacity-50"
                        >
                            {busyKey === 'sync-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Sync all
                        </button>
                        <button
                            onClick={handleRefreshInventory}
                            disabled={busyKey === 'refresh-inventory'}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-cream/80 transition hover:bg-white/10 disabled:opacity-50"
                        >
                            {busyKey === 'refresh-inventory' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                            Inventory
                        </button>
                    </div>
                </div>
            </div>

            {toast && (
                <div className={`mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm backdrop-blur-xl ${toast.success ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-red-400/25 bg-red-500/10 text-red-100'}`}>
                    {toast.success ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <XCircle className="mt-0.5 h-4 w-4" />}
                    <span>{toast.message}</span>
                </div>
            )}

            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {metricCards.map(({ label, value, Icon, tone, subtext }) => (
                    <div key={label} className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/25 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
                        <div className="absolute right-4 top-4 opacity-10">
                            <Icon className="h-14 w-14 text-cream" />
                        </div>
                        <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 ${tone}`}>
                            <Icon className="h-5 w-5" />
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.22em] text-cream/45">{label}</p>
                        <div className="mt-2 flex items-end gap-3">
                            <span className="font-serif text-4xl text-cream">{value}</span>
                            <span className="mb-2 text-xs text-cream/45">{subtext}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur-2xl">
                    <div className="flex flex-wrap gap-2">
                        {FILTERS.map(item => (
                            <button
                                key={item.key}
                                onClick={() => setFilter(item.key)}
                                className={`rounded-xl px-4 py-2 text-[10px] uppercase tracking-[0.18em] transition ${filter === item.key ? 'border border-bronze/40 bg-bronze/15 text-amber-100' : 'border border-white/10 bg-white/5 text-cream/45 hover:text-cream'}`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur-2xl">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-[10px] uppercase tracking-[0.24em] text-cream/45">Automation</p>
                            <p className="mt-1 text-sm text-cream">
                                {automation?.balancePaymentReady ? 'Balance payment ready' : automation?.fulfillmentAutomationReady ? 'Manual payment mode' : 'Setup needed'}
                            </p>
                        </div>
                        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] ${automation?.balancePaymentReady ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-amber-300/25 bg-amber-400/10 text-amber-100'}`}>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {automation?.mode || 'checking'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
                <section className="min-h-[560px] rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-3xl">
                    <div className="mb-4 flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase tracking-[0.24em] text-bronze">Order pipeline</p>
                            <h2 className="mt-1 font-serif text-2xl text-cream">{orders ? `${orders.length} orders` : 'Loading orders'}</h2>
                        </div>
                        <ClipboardCheck className="h-5 w-5 text-cream/35" />
                    </div>

                    {!orders ? (
                        <div className="flex h-72 items-center justify-center text-cream/50">
                            <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                            Loading control room
                        </div>
                    ) : orders.length === 0 ? (
                        <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-center text-cream/45">
                            <PackageCheck className="mb-4 h-10 w-10" />
                            <p className="font-serif text-2xl text-cream/60">No orders in this view</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {orders.map(order => (
                                <button
                                    key={order.orderId || `${order.customerEmail}-${order.createdAt}`}
                                    onClick={() => order.orderId && setSelectedOrderId(asOrderId(order.orderId) || null)}
                                    className={`w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.07] ${currentOrder?.orderId === order.orderId ? 'border-bronze/50 bg-bronze/10 shadow-[0_0_28px_rgba(168,140,119,0.12)]' : 'border-white/10 bg-black/25'}`}
                                >
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${pipelineClasses[order.pipelineState] || 'border-white/10 bg-white/5 text-cream/70'}`}>
                                                    {order.pipelineLabel}
                                                </span>
                                                {order.needsReview && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-red-400/25 bg-red-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-red-100">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        Review
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="mt-3 truncate font-serif text-xl text-cream">{order.customerName}</h3>
                                            <p className="mt-1 truncate text-xs text-cream/45">{order.customerEmail}</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 text-xs text-cream/55 md:grid-cols-4 lg:min-w-[520px]">
                                            <div>
                                                <span className="block text-[9px] uppercase tracking-[0.18em] text-cream/35">Total</span>
                                                <span className="mt-1 block text-cream">{formatMoney(order.total, order.currency)}</span>
                                            </div>
                                            <div>
                                                <span className="block text-[9px] uppercase tracking-[0.18em] text-cream/35">CJ order</span>
                                                <span className="mt-1 block truncate text-cream/75">{order.cjOrderId || 'Not sent'}</span>
                                            </div>
                                            <div>
                                                <span className="block text-[9px] uppercase tracking-[0.18em] text-cream/35">Tracking</span>
                                                <span className="mt-1 block truncate text-cream/75">{order.trackingNumber || 'Waiting'}</span>
                                            </div>
                                            <div>
                                                <span className="block text-[9px] uppercase tracking-[0.18em] text-cream/35">Next</span>
                                                <span className="mt-1 block truncate text-amber-100">{order.nextAction}</span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <aside className="rounded-[2rem] border border-white/10 bg-black/35 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-3xl xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto custom-scrollbar">
                    {!currentOrder ? (
                        <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-cream/45">
                            <FileText className="mb-4 h-10 w-10" />
                            <p className="font-serif text-2xl text-cream/60">Select an order</p>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.24em] text-bronze">Selected order</p>
                                <h2 className="mt-2 font-serif text-2xl text-cream">{currentOrder.customerName}</h2>
                                <p className="mt-1 text-sm text-cream/45">{currentOrder.customerEmail}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <DetailBox label="Pipeline" value={currentOrder.pipelineLabel} />
                                <DetailBox label="Last update" value={formatDate(currentOrder.lastActivityAt)} />
                                <DetailBox label="CJ order" value={currentOrder.cjOrderId || 'Not sent'} />
                                <DetailBox label="Payment" value={currentOrder.cjPaymentStatus || 'Not started'} />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => handleRetryOrder(currentOrder.orderId)}
                                    disabled={!currentOrder.orderId || busyKey === `retry-${currentOrder.orderId}`}
                                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-bronze/30 bg-bronze/15 px-3 py-3 text-[10px] uppercase tracking-[0.16em] text-amber-100 transition hover:bg-bronze/20 disabled:opacity-50"
                                >
                                    {busyKey === `retry-${currentOrder.orderId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                    Retry
                                </button>
                                <button
                                    onClick={() => handleSyncOrder(currentOrder.orderId)}
                                    disabled={!currentOrder.orderId || busyKey === `sync-${currentOrder.orderId}`}
                                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] uppercase tracking-[0.16em] text-cream/80 transition hover:bg-white/10 disabled:opacity-50"
                                >
                                    {busyKey === `sync-${currentOrder.orderId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                    Sync
                                </button>
                                {currentOrder.cjPaymentUrl && (
                                    <button
                                        onClick={() => window.open(currentOrder.cjPaymentUrl, '_blank', 'noopener,noreferrer')}
                                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-3 text-[10px] uppercase tracking-[0.16em] text-amber-100 transition hover:bg-amber-400/15"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        Payment
                                    </button>
                                )}
                                {currentOrder.trackingUrl && (
                                    <button
                                        onClick={() => window.open(currentOrder.trackingUrl, '_blank', 'noopener,noreferrer')}
                                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-purple-300/25 bg-purple-400/10 px-3 py-3 text-[10px] uppercase tracking-[0.16em] text-purple-100 transition hover:bg-purple-400/15"
                                    >
                                        <ArrowUpRight className="h-4 w-4" />
                                        Track
                                    </button>
                                )}
                            </div>

                            <section>
                                <div className="mb-3 flex items-center justify-between">
                                    <p className="text-[10px] uppercase tracking-[0.24em] text-cream/45">Risks</p>
                                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-cream/45">{orderedRisks.length}</span>
                                </div>
                                <div className="space-y-3">
                                    {orderedRisks.length === 0 ? (
                                        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                                            Everything visible for this order is moving normally.
                                        </div>
                                    ) : orderedRisks.map(risk => (
                                        <div key={risk.key} className={`rounded-2xl border p-4 ${severityClasses[risk.severity]}`}>
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <h3 className="text-sm font-medium text-cream">{risk.title}</h3>
                                                    <p className="mt-1 text-xs leading-5 text-cream/60">{risk.description}</p>
                                                    <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-bronze">{risk.nextAction}</p>
                                                    {risk.reviewed && (
                                                        <p className="mt-2 text-[10px] text-cream/45">Reviewed {formatDate(risk.reviewed.reviewedAt)}</p>
                                                    )}
                                                </div>
                                                {!risk.reviewed && (
                                                    <button
                                                        onClick={() => handleMarkReviewed(risk)}
                                                        disabled={busyKey === `review-${risk.key}`}
                                                        className="shrink-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-cream/70 transition hover:bg-white/10 disabled:opacity-50"
                                                    >
                                                        {busyKey === `review-${risk.key}` ? 'Saving' : 'Review'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section>
                                <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-cream/45">Internal note</p>
                                <textarea
                                    value={note}
                                    onChange={(event) => setNote(event.target.value)}
                                    placeholder="Add a fulfillment note..."
                                    className="min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/25 p-3 text-sm text-cream outline-none transition placeholder:text-cream/25 focus:border-bronze/50"
                                />
                                <button
                                    onClick={handleAddNote}
                                    disabled={!note.trim() || busyKey === 'add-note'}
                                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-cream/80 transition hover:bg-white/10 disabled:opacity-50"
                                >
                                    {busyKey === 'add-note' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                    Add note
                                </button>
                            </section>

                            <section>
                                <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-cream/45">Recent notes</p>
                                <div className="space-y-2">
                                    {!audits ? (
                                        <p className="text-xs text-cream/40">Loading notes...</p>
                                    ) : audits.length === 0 ? (
                                        <p className="text-xs text-cream/40">No notes yet.</p>
                                    ) : audits.slice(0, 5).map(audit => (
                                        <div key={audit._id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-xs text-cream/70">{audit.title || (audit.actionType === 'risk_reviewed' ? 'Risk reviewed' : 'Note')}</p>
                                                <span className="text-[10px] text-cream/35">{formatDate(audit.createdAt)}</span>
                                            </div>
                                            {audit.note && <p className="mt-2 text-xs leading-5 text-cream/50">{audit.note}</p>}
                                            <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-cream/30">{audit.actorEmail}</p>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
};

const DetailBox: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="min-h-20 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <p className="text-[9px] uppercase tracking-[0.18em] text-cream/35">{label}</p>
        <p className="mt-2 break-words text-sm text-cream/80">{value}</p>
    </div>
);
