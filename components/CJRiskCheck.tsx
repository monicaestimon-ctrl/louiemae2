import React, { useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Id } from '../convex/_generated/dataModel';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock3,
    FileText,
    Loader2,
    PackageCheck,
    RefreshCw,
    RotateCcw,
    SatelliteDish,
    ShieldAlert,
    ShieldCheck,
    XCircle,
} from 'lucide-react';

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';
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

type RiskItem = {
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

type SystemStatus = {
    webhooks: {
        lastOrderWebhookLabel: string;
        lastLogisticWebhookLabel: string;
        lastProductWebhookLabel: string;
        failedWebhookCount: number;
        retryableWebhookCount: number;
    };
    jobs: {
        latestTrackingSyncLabel: string;
        latestInventoryRefreshLabel: string;
    };
};

const SEVERITY_FILTERS: Array<{ key: SeverityFilter; label: string }> = [
    { key: 'all', label: 'Unresolved' },
    { key: 'critical', label: 'Critical' },
    { key: 'warning', label: 'Warnings' },
    { key: 'info', label: 'Info' },
];

const severityClasses: Record<RiskSeverity, string> = {
    critical: 'border-red-400/30 bg-red-500/10 text-red-100',
    warning: 'border-amber-300/30 bg-amber-400/10 text-amber-100',
    info: 'border-white/15 bg-white/5 text-cream/70',
};

const severityIcon: Record<RiskSeverity, React.ReactNode> = {
    critical: <ShieldAlert className="h-4 w-4" />,
    warning: <AlertTriangle className="h-4 w-4" />,
    info: <Activity className="h-4 w-4" />,
};

const asOrderId = (value: string | undefined) => value as Id<'orders'> | undefined;
const asProductId = (value: string | undefined) => value as Id<'products'> | undefined;

const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

const formatDate = (value?: string) => {
    if (!value) return 'Not recorded';
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(value));
};

export const CJRiskCheck: React.FC = () => {
    const [severity, setSeverity] = useState<SeverityFilter>('all');
    const [includeReviewed, setIncludeReviewed] = useState(false);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [toast, setToast] = useState<{ success: boolean; message: string } | null>(null);
    const [noteByRisk, setNoteByRisk] = useState<Record<string, string>>({});

    const summary = useQuery(api.cjRiskMonitor.getSummary);
    const risks = useQuery(api.cjRiskMonitor.getRisks, { severity, includeReviewed, limit: 75 }) as RiskItem[] | undefined;
    const systemStatus = useQuery(api.cjRiskMonitor.getSystemStatus) as SystemStatus | undefined;

    const configureWebhooks = useAction(api.cjActions.configureWebhooks);
    const syncTracking = useAction(api.cjActions.syncTracking);
    const syncOrderTracking = useAction(api.cjActions.syncOrderTracking);
    const retryOrderFulfillment = useAction(api.cjActions.retryOrderFulfillment);
    const refreshInventory = useAction(api.cjActions.refreshInventory);
    const testConnection = useAction(api.cjActions.testConnection);
    const markRiskReviewed = useMutation(api.cjFulfillmentAudits.markRiskReviewed);
    const addFulfillmentNote = useMutation(api.cjFulfillmentAudits.addFulfillmentNote);

    const riskSummary = summary?.riskSummary;
    const isAllClear = (riskSummary?.critical ?? 0) === 0 && (riskSummary?.warning ?? 0) === 0;

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

    const handleRiskAction = (risk: RiskItem) => {
        const orderId = asOrderId(risk.orderId);
        const productId = asProductId(risk.productId);

        switch (risk.actionKey) {
            case 'configure_webhooks':
                void runWithToast(`action-${risk.key}`, async () => {
                    const result = await configureWebhooks({});
                    if (!result.success) throw new Error(result.message);
                    return result.message;
                });
                break;
            case 'sync_all_tracking':
                void runWithToast(`action-${risk.key}`, async () => {
                    const result = await syncTracking({});
                    return `Synced ${result.synced} orders${result.errors ? `, ${result.errors} errors` : ''}`;
                });
                break;
            case 'sync_order_tracking':
                if (!orderId) return;
                void runWithToast(`action-${risk.key}`, async () => {
                    const result = await syncOrderTracking({ orderId });
                    if (!result.success) throw new Error(result.message || result.error || 'Tracking sync failed');
                    return result.message || 'Tracking synced';
                });
                break;
            case 'retry_order':
                if (!orderId) return;
                void runWithToast(`action-${risk.key}`, async () => {
                    const result = await retryOrderFulfillment({ orderId });
                    if (!result.success) throw new Error(result.message || result.error || 'CJ retry failed');
                    return result.message || 'CJ retry submitted';
                });
                break;
            case 'refresh_inventory':
                void runWithToast(`action-${risk.key}`, async () => {
                    const result = await refreshInventory(productId ? { productId } : {});
                    return `Inventory refreshed for ${result.updated}/${result.checked} products${result.errors ? `, ${result.errors} errors` : ''}`;
                });
                break;
            default:
                setToast({ success: true, message: risk.nextAction });
        }
    };

    const handleMarkReviewed = (risk: RiskItem) => {
        void runWithToast(`review-${risk.key}`, async () => {
            await markRiskReviewed({
                riskKey: risk.key,
                riskType: risk.type,
                severity: risk.severity,
                title: risk.title,
                orderId: asOrderId(risk.orderId),
                productId: asProductId(risk.productId),
                note: noteByRisk[risk.key]?.trim() || undefined,
            });
            setNoteByRisk(prev => ({ ...prev, [risk.key]: '' }));
            return 'Risk marked reviewed';
        });
    };

    const handleAddNote = (risk: RiskItem) => {
        const note = noteByRisk[risk.key]?.trim();
        if (!note) return;

        void runWithToast(`note-${risk.key}`, async () => {
            await addFulfillmentNote({
                orderId: asOrderId(risk.orderId),
                productId: asProductId(risk.productId),
                riskKey: risk.key,
                note,
            });
            setNoteByRisk(prev => ({ ...prev, [risk.key]: '' }));
            return 'Note added';
        });
    };

    const topCards = [
        {
            label: 'Critical',
            value: riskSummary?.critical ?? 0,
            subtext: 'Fix before assuming hands-off',
            Icon: ShieldAlert,
            tone: 'text-red-100',
        },
        {
            label: 'Warnings',
            value: riskSummary?.warning ?? 0,
            subtext: 'Watch or clear today',
            Icon: AlertTriangle,
            tone: 'text-amber-100',
        },
        {
            label: 'Reviewed',
            value: summary?.reviewedRiskCount ?? 0,
            subtext: 'Already checked',
            Icon: CheckCircle2,
            tone: 'text-emerald-100',
        },
        {
            label: 'Total risks',
            value: riskSummary?.totalRisks ?? 0,
            subtext: includeReviewed ? 'Including reviewed' : 'Unresolved only',
            Icon: Activity,
            tone: 'text-blue-100',
        },
    ];

    return (
        <div className="p-2 md:p-8 animate-fade-in-up">
            <div className="relative mb-8 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-3xl">
                <div className="absolute right-0 top-0 h-56 w-56 rounded-bl-full bg-red-500/10 blur-3xl" />
                <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <span className="mb-3 flex items-center gap-3 text-[10px] uppercase tracking-[0.35em] text-bronze">
                            <span className="h-px w-8 bg-bronze/60" />
                            Silent risk monitor
                        </span>
                        <h1 className="font-serif text-3xl text-cream drop-shadow-md md:text-5xl">CJ Risk Check</h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-cream/60">
                            {isAllClear
                                ? 'Everything visible is moving. Keep an eye on webhook and sync freshness.'
                                : 'These are the background issues that can quietly stop fulfillment.'}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => void runWithToast('test-connection', async () => {
                                const result = await testConnection({});
                                if (!result.success) throw new Error(result.message);
                                return result.message;
                            })}
                            disabled={busyKey === 'test-connection'}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-cream/80 transition hover:bg-white/10 disabled:opacity-50"
                        >
                            {busyKey === 'test-connection' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                            Test CJ
                        </button>
                        <button
                            onClick={() => void runWithToast('sync-all', async () => {
                                const result = await syncTracking({});
                                return `Synced ${result.synced} orders${result.errors ? `, ${result.errors} errors` : ''}`;
                            })}
                            disabled={busyKey === 'sync-all'}
                            className="inline-flex items-center gap-2 rounded-xl border border-bronze/30 bg-bronze/15 px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-amber-100 transition hover:bg-bronze/20 disabled:opacity-50"
                        >
                            {busyKey === 'sync-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Sync all
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
                {topCards.map(({ label, value, subtext, Icon, tone }) => (
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

            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-4">
                <HealthCard label="Order webhook" value={systemStatus?.webhooks.lastOrderWebhookLabel || 'Checking'} Icon={SatelliteDish} />
                <HealthCard label="Logistics webhook" value={systemStatus?.webhooks.lastLogisticWebhookLabel || 'Checking'} Icon={SatelliteDish} />
                <HealthCard label="Tracking sync" value={systemStatus?.jobs.latestTrackingSyncLabel || 'Checking'} Icon={Clock3} />
                <HealthCard label="Inventory refresh" value={systemStatus?.jobs.latestInventoryRefreshLabel || 'Checking'} Icon={PackageCheck} />
            </div>

            <div className="mb-6 rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur-2xl">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-2">
                        {SEVERITY_FILTERS.map(item => (
                            <button
                                key={item.key}
                                onClick={() => setSeverity(item.key)}
                                className={`rounded-xl px-4 py-2 text-[10px] uppercase tracking-[0.18em] transition ${severity === item.key ? 'border border-bronze/40 bg-bronze/15 text-amber-100' : 'border border-white/10 bg-white/5 text-cream/45 hover:text-cream'}`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <label className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-cream/55">
                        <input
                            type="checkbox"
                            checked={includeReviewed}
                            onChange={(event) => setIncludeReviewed(event.target.checked)}
                            className="h-4 w-4 accent-[#a88c77]"
                        />
                        Include reviewed
                    </label>
                </div>
            </div>

            <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-3xl">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.24em] text-bronze">Risk queue</p>
                        <h2 className="mt-1 font-serif text-2xl text-cream">{risks ? `${risks.length} items` : 'Loading risks'}</h2>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-cream/45">
                        {systemStatus?.webhooks.failedWebhookCount ?? 0} webhook failures
                    </span>
                </div>

                {!risks ? (
                    <div className="flex h-72 items-center justify-center text-cream/50">
                        <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                        Loading risk monitor
                    </div>
                ) : risks.length === 0 ? (
                    <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-center text-emerald-100">
                        <ShieldCheck className="mb-4 h-10 w-10" />
                        <p className="font-serif text-2xl">No unresolved risks in this view</p>
                        <p className="mt-2 max-w-md text-sm text-cream/55">The system still tracks webhook freshness, inventory freshness, and reviewed items in the background.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {risks.map(risk => (
                            <article key={risk.key} className={`rounded-2xl border p-5 ${severityClasses[risk.severity]}`}>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="mb-3 flex flex-wrap items-center gap-2">
                                            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.16em]">
                                                {severityIcon[risk.severity]}
                                                {risk.severity}
                                            </span>
                                            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-cream/55">
                                                {risk.type}
                                            </span>
                                            {risk.reviewed && (
                                                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-100">
                                                    Reviewed
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="font-serif text-xl text-cream">{risk.title}</h3>
                                        <p className="mt-2 text-sm leading-6 text-cream/65">{risk.description}</p>
                                        <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-bronze">{risk.nextAction}</p>
                                        <p className="mt-2 text-[10px] text-cream/35">Detected {formatDate(risk.createdAt)}</p>
                                    </div>
                                </div>

                                <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                    <button
                                        onClick={() => handleRiskAction(risk)}
                                        disabled={busyKey === `action-${risk.key}`}
                                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-cream/75 transition hover:bg-white/10 disabled:opacity-50"
                                    >
                                        {busyKey === `action-${risk.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                        Action
                                    </button>
                                    <button
                                        onClick={() => handleMarkReviewed(risk)}
                                        disabled={Boolean(risk.reviewed) || busyKey === `review-${risk.key}`}
                                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-cream/75 transition hover:bg-white/10 disabled:opacity-50"
                                    >
                                        {busyKey === `review-${risk.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                        Reviewed
                                    </button>
                                    <button
                                        onClick={() => handleAddNote(risk)}
                                        disabled={!noteByRisk[risk.key]?.trim() || busyKey === `note-${risk.key}`}
                                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-cream/75 transition hover:bg-white/10 disabled:opacity-50"
                                    >
                                        {busyKey === `note-${risk.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                        Note
                                    </button>
                                </div>

                                <textarea
                                    value={noteByRisk[risk.key] || ''}
                                    onChange={(event) => setNoteByRisk(prev => ({ ...prev, [risk.key]: event.target.value }))}
                                    placeholder="Optional note before marking reviewed..."
                                    className="mt-3 min-h-20 w-full resize-none rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-cream outline-none transition placeholder:text-cream/25 focus:border-bronze/50"
                                />
                            </article>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

const HealthCard: React.FC<{ label: string; value: string; Icon: React.ComponentType<{ className?: string }> }> = ({ label, value, Icon }) => (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur-2xl">
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-cream/70">
            <Icon className="h-5 w-5" />
        </div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-cream/40">{label}</p>
        <p className="mt-2 text-sm text-cream">{value}</p>
    </div>
);
