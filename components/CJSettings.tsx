import React, { useState, useEffect } from 'react';
import { useAction, useQuery, useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Id } from '../convex/_generated/dataModel';
import { Wifi, RefreshCw, Settings, CheckCircle, XCircle, Loader2, Package, Clock, AlertTriangle, ArrowRight, ExternalLink, Trash2, RotateCcw, Key, Link2, Search } from 'lucide-react';
import { FadeIn } from './FadeIn';
import { CJVariantManager } from './CJVariantManager';
import { SafeImage } from './SafeImage';

export const CJSettings: React.FC = () => {
    const testConnection = useAction(api.cjActions.testConnection);
    const configureWebhooks = useAction(api.cjActions.configureWebhooks);
    const syncTracking = useAction(api.cjActions.syncTracking);
    const checkSourcing = useAction(api.cjActions.checkSourcingStatus);
    const resubmitProduct = useAction(api.cjActions.resubmitProduct);
    const getTokenStatus = useAction(api.cjActions.getTokenStatus);
    const diagnosePending = useAction(api.cjActions.diagnosePending);

    // Product sourcing queries
    const pendingProducts = useQuery(api.products.getPendingSourcing) || [];
    const recentlyApproved = useQuery(api.products.getRecentlyApproved) || [];
    const rejectedProducts = useQuery(api.products.getRejectedProducts) || [];

    const [testing, setTesting] = useState(false);
    const [configuring, setConfiguring] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [checkingSourcing, setCheckingSourcing] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"products"> | null>(null);
    const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
    const [resubmittingId, setResubmittingId] = useState<Id<"products"> | null>(null);
    const [diagnosing, setDiagnosing] = useState(false);
    const [diagnosticResults, setDiagnosticResults] = useState<Array<{
        productId: string;
        productName: string;
        cjSourcingId: string | null;
        sourcingTicketStatus: string;
        cjProductIdFromTicket: string | null;
        cjProductIdFromCatalog: string | null;
        productFoundInCatalog: boolean;
        variantCount: number;
        autoApproved: boolean;
        diagnosis: string;
    }> | null>(null);
    const [tokenStatus, setTokenStatus] = useState<{
        connected: boolean;
        accessTokenValid: boolean;
        accessTokenExpiresAt?: string;
        refreshTokenValid: boolean;
        refreshTokenExpiresAt?: string;
        message: string;
    } | null>(null);

    // Fetch token status on mount
    useEffect(() => {
        getTokenStatus({}).then(setTokenStatus).catch(() => null);
    }, [getTokenStatus]);

    // Use the admin products.adminRemove mutation for deleting (no auth required)
    const deleteProduct = useMutation(api.products.adminRemove);

    /** Extracts a human-readable message from an unknown caught error. */
    const getErrorMessage = (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback;

    const handleDeleteProduct = async (id: Id<"products">, _productName: string, _cjSourcingId?: string) => {
        if (import.meta.env.DEV) console.log("Delete button clicked for:", _productName, id);

        const confirmed = window.confirm(`Remove "${_productName}" from import queue? This cannot be undone.`);
        if (import.meta.env.DEV) console.log("User confirmed:", confirmed);

        if (!confirmed) return;

        setDeletingId(id);

        try {
            await deleteProduct({ id });
            setResult({ success: true, message: `"${_productName}" removed successfully` });
        } catch (error: unknown) {
            if (import.meta.env.DEV) console.error("Delete failed:", error);
            setResult({ success: false, message: getErrorMessage(error, 'Failed to remove product') });
        } finally {
            setDeletingId(null);
        }
    };

    /** Resubmits a product for CJ sourcing. */
    const handleResubmit = async (id: Id<"products">) => {
        setResubmittingId(id);
        setResult(null);

        try {
            const res = await resubmitProduct({ productId: id });
            setResult({ success: res.success, message: res.message });
            getTokenStatus({}).then(setTokenStatus).catch(() => null);
        } catch (error: unknown) {
            setResult({ success: false, message: getErrorMessage(error, 'Failed to resubmit product') });
        } finally {
            setResubmittingId(null);
        }
    };

    // Helper to format time since submission
    const getTimeSinceSubmission = (submittedAt?: string) => {
        if (!submittedAt) return null;
        const diff = Date.now() - new Date(submittedAt).getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h`;
        const mins = Math.floor(diff / (1000 * 60));
        return `${mins}m`;
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setResult(null);
        try {
            const res = await testConnection({});
            setResult(res);
        } catch (error: unknown) {
            setResult({ success: false, message: getErrorMessage(error, 'Connection test failed') });
        } finally {
            setTesting(false);
        }
    };

    const handleConfigureWebhooks = async () => {
        setConfiguring(true);
        setResult(null);
        try {
            const res = await configureWebhooks({});
            setResult(res);
        } catch (error: unknown) {
            setResult({ success: false, message: getErrorMessage(error, 'Webhook configuration failed') });
        } finally {
            setConfiguring(false);
        }
    };

    const handleSyncTracking = async () => {
        setSyncing(true);
        setResult(null);
        try {
            const res = await syncTracking({});
            setResult({
                success: true,
                message: `Synced ${res.synced} orders${res.errors > 0 ? `, ${res.errors} errors` : ''}`
            });
        } catch (error: unknown) {
            setResult({ success: false, message: getErrorMessage(error, 'Tracking sync failed') });
        } finally {
            setSyncing(false);
        }
    };

    const handleCheckSourcing = async () => {
        setCheckingSourcing(true);
        setResult(null);
        try {
            const res = await checkSourcing({});
            setResult({
                success: true,
                message: `Checked ${res.checked} products: ${res.approved} approved, ${res.rejected} rejected`
            });
        } catch (error: unknown) {
            setResult({ success: false, message: getErrorMessage(error, 'Sourcing check failed') });
        } finally {
            setCheckingSourcing(false);
        }
    };

    const handleDiagnose = async () => {
        setDiagnosing(true);
        setResult(null);
        setDiagnosticResults(null);
        try {
            const res = await diagnosePending({});
            setDiagnosticResults(res.results);
            const approvedCount = res.results.filter((r: any) => r.autoApproved).length;
            setResult({
                success: approvedCount > 0,
                message: res.summary,
            });
        } catch (error: unknown) {
            setResult({ success: false, message: getErrorMessage(error, 'Diagnosis failed') });
        } finally {
            setDiagnosing(false);
        }
    };

    // Action Card Component (Refined & Minimalist)
    const ActionCard = ({ icon: Icon, title, description, loading, onClick, colorClass = "text-bronze" }: { icon: React.FC<{ className?: string }>; title: string; description: string; loading: boolean; onClick: () => void; colorClass?: string }) => (
        <button
            type="button"
            onClick={onClick}
            disabled={loading}
            className="group relative backdrop-blur-xl bg-black/40 border border-white/10 p-4 md:p-6 shadow-[0_10px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_15px_30px_rgba(0,0,0,0.5)] transition-all duration-500 cursor-pointer overflow-hidden rounded-[2rem] hover:bg-white/5 active:scale-[0.98] md:hover:-translate-y-1 text-left w-full disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze/50"
        >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-[2rem]" />
            <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none" />

            <div className="flex justify-between items-start mb-4 relative z-10">
                <div className={`p-3 rounded-2xl bg-white/5 backdrop-blur-md shadow-inner border border-white/10 group-hover:scale-110 group-hover:bg-white/10 transition-all duration-300`}>
                    <Icon className={`w-5 h-5 ${colorClass}`} />
                </div>
                <div className="opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 bg-white/5 p-2 rounded-full border border-white/10">
                    <ArrowRight className="w-4 h-4 text-cream/60 group-hover:text-cream" />
                </div>
            </div>

            <div className="relative z-10">
                <h3 className="font-serif text-lg text-cream font-medium mb-1 drop-shadow-sm group-hover:text-amber-400 transition-colors">{title}</h3>
                <p className="text-xs text-cream/50 leading-relaxed font-sans line-clamp-2">{description}</p>
            </div>

            {loading && (
                <div className="absolute bottom-4 right-4 animate-pulse">
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin drop-shadow-[0_0_5px_currentColor]" />
                </div>
            )}
        </button>
    );

    return (
        <div className="relative min-h-screen overflow-hidden p-4 md:p-8">
            {/* Animated Background Blobs */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-0 -left-4 w-72 h-72 bg-bronze/10 rounded-full mix-blend-screen filter blur-3xl opacity-50 animate-blob" />
                <div className="absolute top-0 -right-4 w-72 h-72 bg-black/40 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000" />
                <div className="absolute -bottom-8 left-20 w-72 h-72 bg-amber-900/10 rounded-full mix-blend-screen filter blur-3xl opacity-50 animate-blob animation-delay-4000" />
            </div>

            {/* Header */}
            <div className="mb-12 relative z-10">
                <FadeIn>
                    <span className="text-[10px] uppercase tracking-[0.4em] mb-3 font-medium text-amber-400 flex items-center gap-2 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]">
                        <span className="w-8 h-px bg-amber-400/50 shadow-[#FBBF24]"></span>
                        Integration Center
                    </span>
                    <h1 className="font-serif text-3xl md:text-5xl text-cream drop-shadow-md tracking-tight">CJ Dropshipping Link</h1>
                </FadeIn>
            </div>

            {/* Notification Banner */}
            {result && (
                <FadeIn className="mb-8 relative z-20">
                    <div className={`p-4 md:p-5 border backdrop-blur-xl rounded-[2rem] flex items-start md:items-center gap-3 md:gap-4 shadow-[0_10px_20px_rgba(0,0,0,0.3)] relative overflow-hidden ${result.success
                        ? 'bg-green-900/20 border-green-500/30 text-green-400'
                        : 'bg-red-900/20 border-red-500/30 text-red-400'
                        }`}>
                        <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none"></div>
                        {result.success ? <CheckCircle className="w-5 h-5 drop-shadow-[0_0_3px_currentColor]" /> : <XCircle className="w-5 h-5 drop-shadow-[0_0_3px_currentColor]" />}
                        <span className="font-medium tracking-wide text-xs md:text-sm flex-1 break-words relative z-10">{result.message}</span>
                        <button onClick={() => setResult(null)} aria-label="Dismiss notification" className="ml-auto hover:bg-white/10 p-1.5 rounded-full transition-colors relative z-10 border border-transparent hover:border-white/10">
                            <XCircle className="w-4 h-4 opacity-50 hover:opacity-100" />
                        </button>
                    </div>
                </FadeIn>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">

                {/* Panel 1: Main Controls */}
                <div className="space-y-8">
                    <FadeIn delay={100}>
                        <h2 className="font-serif text-2xl text-cream drop-shadow-sm mb-6 flex items-center gap-3">
                            <Settings className="w-5 h-5 text-amber-500 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]" />
                            System Controls
                        </h2>
                        <div className="grid grid-cols-2 gap-3 md:gap-6">
                            <ActionCard
                                icon={Wifi}
                                title="Connection"
                                description="Verify API connectivity with CJ."
                                onClick={handleTestConnection}
                                loading={testing}
                                colorClass="text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]"
                            />

                            <ActionCard
                                icon={ExternalLink}
                                title="Webhooks"
                                description="Setup status callbacks."
                                onClick={handleConfigureWebhooks}
                                loading={configuring}
                                colorClass="text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]"
                            />

                            <ActionCard
                                icon={RefreshCw}
                                title="Tracking"
                                description="Pull latest tracking numbers."
                                onClick={handleSyncTracking}
                                loading={syncing}
                                colorClass="text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]"
                            />

                            <ActionCard
                                icon={Package}
                                title="Sourcing"
                                description="Update sourcing status."
                                onClick={handleCheckSourcing}
                                loading={checkingSourcing}
                                colorClass="text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]"
                            />
                        </div>
                    </FadeIn>

                    {/* Token Status Card */}
                    <FadeIn delay={150}>
                        <div className="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-[2rem] p-6 shadow-[0_15px_30px_rgba(0,0,0,0.3)] relative overflow-hidden">
                            <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none"></div>
                            
                            <div className="flex items-center gap-4 mb-6 relative z-10">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner ${tokenStatus?.connected
                                    ? 'bg-green-900/30 border border-green-500/30'
                                    : 'bg-red-900/30 border border-red-500/30'
                                    }`}>
                                    <Key className={`w-5 h-5 drop-shadow-[0_0_3px_currentColor] ${tokenStatus?.connected ? 'text-green-400' : 'text-red-400'}`} />
                                </div>
                                <div>
                                    <h3 className="font-serif text-lg text-cream drop-shadow-sm">API Connection</h3>
                                    <span className={`text-[10px] uppercase tracking-widest font-medium flex items-center gap-1.5 mt-1 ${tokenStatus?.connected ? 'text-green-400' : 'text-red-400'
                                        }`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${tokenStatus?.connected ? 'bg-green-400 shadow-[0_0_5px_#4ade80]' : 'bg-red-400 shadow-[0_0_5px_#f87171] animate-pulse'}`}></span>
                                        {tokenStatus?.connected ? 'Connected' : 'Disconnected'}
                                    </span>
                                </div>
                            </div>

                            {tokenStatus && (
                                <div className="space-y-3 text-xs relative z-10">
                                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl shadow-inner">
                                        <span className="text-cream/50 uppercase tracking-widest text-[10px]">Access Token</span>
                                        <span className={`font-mono text-[11px] ${tokenStatus.accessTokenValid ? 'text-green-400 drop-shadow-[0_0_2px_rgba(74,222,128,0.5)]' : 'text-amber-400 drop-shadow-[0_0_2px_rgba(251,191,36,0.5)]'}`}>
                                            {tokenStatus.accessTokenValid
                                                ? `Valid to ${tokenStatus.accessTokenExpiresAt ? new Date(tokenStatus.accessTokenExpiresAt).toLocaleDateString() : 'N/A'}`
                                                : 'Expired (auto-refreshes)'
                                            }
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl shadow-inner">
                                        <span className="text-cream/50 uppercase tracking-widest text-[10px]">Refresh Token</span>
                                        <span className={`font-mono text-[11px] ${tokenStatus.refreshTokenValid ? 'text-green-400 drop-shadow-[0_0_2px_rgba(74,222,128,0.5)]' : 'text-red-400 drop-shadow-[0_0_2px_rgba(248,113,113,0.5)]'}`}>
                                            {tokenStatus.refreshTokenValid
                                                ? `Valid to ${tokenStatus.refreshTokenExpiresAt ? new Date(tokenStatus.refreshTokenExpiresAt).toLocaleDateString() : 'N/A'}`
                                                : 'Expired - reconnect'
                                            }
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </FadeIn>
                </div>

                {/* Panel 2 & 3: Product Import Pipeline */}
                <div className="lg:col-span-2 space-y-8">
                    <FadeIn delay={200}>
                        <h2 className="font-serif text-2xl text-cream drop-shadow-sm mb-6 flex items-center gap-3">
                            <Clock className="w-5 h-5 text-amber-500 drop-shadow-[0_0_5px_rgba(245,158,11,0.5)]" />
                            Import Pipeline
                        </h2>
                    </FadeIn>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Pending Products - Glass Panel */}
                        <FadeIn delay={300} className="h-full">
                            <div className="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-[2rem] p-6 shadow-[0_15px_30px_rgba(0,0,0,0.3)] h-full flex flex-col relative overflow-hidden group">
                                <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none z-0"></div>
                                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none z-0"></div>

                                <div className="flex items-center gap-4 mb-6 relative z-10">
                                    <div className="w-12 h-12 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-center shadow-inner group-hover:scale-110 group-hover:bg-white/10 transition-all duration-500">
                                        <Clock className="w-6 h-6 text-cream/60 group-hover:text-cream drop-shadow-sm transition-colors" />
                                    </div>
                                    <div>
                                        <h3 className="font-serif text-xl text-cream leading-tight drop-shadow-sm">Pending Review</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_5px_rgba(251,191,36,0.8)]" />
                                            <span className="text-[10px] uppercase tracking-widest text-cream/50 font-medium">
                                                {pendingProducts.length} Items Waiting
                                            </span>
                                        </div>
                                    </div>
                                    {/* Diagnose & Fix button */}
                                    {pendingProducts.length > 0 && (
                                        <button
                                            onClick={handleDiagnose}
                                            disabled={diagnosing}
                                            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/30 border border-emerald-500/30 rounded-xl transition-all disabled:opacity-50 shadow-inner"
                                            title="Deep-verify each product against CJ's catalog and auto-approve confirmed items"
                                        >
                                            {diagnosing ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin drop-shadow-[0_0_3px_currentColor]" />
                                            ) : (
                                                <Search className="w-3.5 h-3.5 drop-shadow-[0_0_3px_currentColor]" />
                                            )}
                                            {diagnosing ? 'Verifying...' : 'Diagnose & Fix'}
                                        </button>
                                    )}
                                </div>

                                {pendingProducts.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center text-cream/30 py-12 relative z-10">
                                        <CheckCircle className="w-12 h-12 mb-3 opacity-50 drop-shadow-sm text-green-400" />
                                        <p className="font-serif text-lg tracking-wide text-green-400/50">All cleared</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4 relative z-10 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                        {pendingProducts.map((product) => {
                                            const timeSince = getTimeSinceSubmission(product.cjSubmittedAt);

                                            return (
                                                <div key={product._id} className="group/item bg-white/5 hover:bg-white/10 border border-white/10 p-4 rounded-2xl transition-all duration-300 shadow-inner hover:shadow-[0_5px_15px_rgba(0,0,0,0.3)]">
                                                    <div className="flex items-start gap-4">
                                                        {/* Image Preview */}
                                                        <div className="h-16 w-16 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 overflow-hidden flex-shrink-0 relative shadow-inner">
                                                            {product.images && product.images[0] && !failedImages.has(product._id) ? (
                                                                <SafeImage
                                                                    src={product.images[0]}
                                                                    alt=""
                                                                    className="h-full w-full object-cover opacity-90 group-hover/item:opacity-100 transition-opacity"
                                                                    onError={() => {
                                                                        setFailedImages(prev => new Set(prev).add(product._id));
                                                                    }}
                                                                />
                                                            ) : (
                                                                <div className="h-full w-full flex items-center justify-center text-cream/20">
                                                                    <Package className="w-6 h-6" />
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="flex-1 min-w-0 pt-1">
                                                            <h4 className="font-medium text-cream text-sm truncate font-serif leading-tight mb-2 drop-shadow-sm">{product.name}</h4>

                                                            {/* Status Row */}
                                                            {(() => {
                                                                const isStuck = product.cjSubmittedAt && (Date.now() - new Date(product.cjSubmittedAt).getTime()) > 24 * 60 * 60 * 1000;
                                                                return (
                                                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-cream/40 mb-3 flex-wrap">
                                                                        {isStuck ? (
                                                                            <>
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse shadow-[0_0_5px_#f87171]"></span>
                                                                                <span className="text-red-400 font-semibold drop-shadow-[0_0_3px_rgba(248,113,113,0.5)]">Stuck</span>
                                                                                <span className="text-red-400/60 normal-case tracking-normal text-[9px]">(auto-retry queued)</span>
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_3px_#fbbf24]"></span>
                                                                                <span>Awaiting CJ</span>
                                                                            </>
                                                                        )}
                                                                        {timeSince && (
                                                                            <>
                                                                                <span className="text-white/20">•</span>
                                                                                <span className={`flex items-center gap-1 ${isStuck ? 'text-red-400/70' : ''}`}>
                                                                                    <Clock className="w-3 h-3 text-cream/30" />
                                                                                    {timeSince} ago
                                                                                </span>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })()}

                                                            {/* CJ Info */}
                                                            <div className="space-y-1 text-[10px] font-medium tracking-widest">
                                                                {product.cjSourcingId ? (
                                                                    <div className="flex items-center gap-1.5 font-mono bg-green-500/10 text-green-400 border border-green-500/20 px-2.5 py-1 rounded-lg w-fit shadow-inner">
                                                                        <Link2 className="w-3 h-3 drop-shadow-[0_0_2px_currentColor]" />
                                                                        CJ ID: {product.cjSourcingId.slice(-12)}...
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-1.5 text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg w-fit shadow-inner">
                                                                        <AlertTriangle className="w-3 h-3 drop-shadow-[0_0_2px_currentColor]" />
                                                                        No CJ ID yet
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Action Buttons */}
                                                    <div className="flex flex-wrap items-center justify-end gap-2 mt-4 pt-3 border-t border-white/5">
                                                        {/* Resubmit */}
                                                        <button
                                                            onClick={() => handleResubmit(product._id)}
                                                            disabled={resubmittingId === product._id}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 active:bg-amber-500/30 rounded-lg transition-all disabled:opacity-50 border border-amber-500/30 shadow-inner uppercase tracking-widest"
                                                            title="Resubmit to CJ"
                                                        >
                                                            {resubmittingId === product._id ? (
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin drop-shadow-[0_0_3px_currentColor]" />
                                                            ) : (
                                                                <RotateCcw className="w-3.5 h-3.5 drop-shadow-[0_0_3px_currentColor]" />
                                                            )}
                                                            Resubmit
                                                        </button>

                                                        {/* Source URL link */}
                                                        {product.sourceUrl && (
                                                            <a
                                                                href={product.sourceUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-cream/40 hover:text-cream hover:bg-white/10 rounded-lg transition-all border border-transparent hover:border-white/10"
                                                                title="View source"
                                                            >
                                                                <ExternalLink className="w-3.5 h-3.5" />
                                                            </a>
                                                        )}

                                                        {/* Delete */}
                                                        <button
                                                            onClick={() => handleDeleteProduct(product._id, product.name, product.cjSourcingId)}
                                                            disabled={deletingId === product._id}
                                                            className="p-1.5 text-red-400/70 hover:text-red-400 active:text-red-400 hover:bg-red-500/20 active:bg-red-500/30 rounded-lg transition-all disabled:opacity-50 border border-transparent hover:border-red-500/30"
                                                            title="Remove from import"
                                                        >
                                                            {deletingId === product._id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-4 h-4 drop-shadow-[0_0_3px_currentColor]" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </FadeIn>

                        {/* Diagnostic Results Panel — shown after clicking Diagnose & Fix */}
                        {diagnosticResults && diagnosticResults.length > 0 && (
                            <FadeIn delay={350} className="md:col-span-2">
                                <div className="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-[2rem] p-6 shadow-[0_15px_30px_rgba(0,0,0,0.3)] relative overflow-hidden">
                                    <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none z-0"></div>
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none z-0"></div>

                                    <div className="flex items-center justify-between gap-4 mb-5 relative z-10">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-2xl bg-emerald-900/20 backdrop-blur-md border border-emerald-500/30 flex items-center justify-center shadow-inner">
                                                <Search className="w-5 h-5 text-emerald-400 drop-shadow-[0_0_4px_rgba(52,211,153,0.5)]" />
                                            </div>
                                            <h3 className="font-serif text-lg text-cream leading-tight drop-shadow-sm">CJ Verification Results</h3>
                                        </div>
                                        <button
                                            onClick={() => setDiagnosticResults(null)}
                                            className="text-cream/30 hover:text-cream/60 text-xs uppercase tracking-widest transition-colors"
                                        >
                                            Dismiss
                                        </button>
                                    </div>

                                    <div className="space-y-3 relative z-10">
                                        {diagnosticResults.map((diag) => (
                                            <div
                                                key={diag.productId}
                                                className={`p-4 rounded-xl border backdrop-blur-md shadow-inner ${
                                                    diag.autoApproved
                                                        ? 'bg-green-500/10 border-green-500/25'
                                                        : diag.productFoundInCatalog
                                                        ? 'bg-emerald-500/10 border-emerald-500/20'
                                                        : 'bg-amber-500/5 border-amber-500/15'
                                                }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    {diag.autoApproved ? (
                                                        <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5 drop-shadow-[0_0_3px_rgba(74,222,128,0.5)]" />
                                                    ) : (
                                                        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5 drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]" />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                                            <span className="font-medium text-cream text-sm truncate drop-shadow-sm">{diag.productName}</span>
                                                            {diag.autoApproved && (
                                                                <span className="text-[9px] font-bold uppercase tracking-widest text-green-400 bg-green-500/20 px-2 py-0.5 rounded-full border border-green-500/30 shadow-inner">
                                                                    Auto-Approved ✓
                                                                </span>
                                                            )}
                                                        </div>

                                                        <p className="text-cream/60 text-xs leading-relaxed mb-2">{diag.diagnosis}</p>

                                                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-cream/40">
                                                            {diag.sourcingTicketStatus !== 'unknown' && (
                                                                <span>Ticket: <span className="text-cream/60">{diag.sourcingTicketStatus}</span></span>
                                                            )}
                                                            {diag.cjProductIdFromTicket && (
                                                                <span>PID: <span className="text-cream/60">{diag.cjProductIdFromTicket}</span></span>
                                                            )}
                                                            {diag.cjProductIdFromCatalog && (
                                                                <span>Catalog: <span className="text-green-400">{diag.cjProductIdFromCatalog}</span></span>
                                                            )}
                                                            {diag.variantCount > 0 && (
                                                                <span>Variants: <span className="text-cream/60">{diag.variantCount}</span></span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </FadeIn>
                        )}

                        {/* Rejected & Approved Stack */}
                        <div className="space-y-8">

                            {/* Approved - Glass Panel */}
                            <FadeIn delay={400}>
                                <div className="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-[2rem] p-6 shadow-[0_15px_30px_rgba(0,0,0,0.3)] relative overflow-hidden group">
                                    <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none z-0"></div>
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none z-0"></div>

                                    <div className="flex items-center gap-4 mb-6 relative z-10">
                                        <div className="w-12 h-12 rounded-2xl bg-green-900/20 backdrop-blur-md border border-green-500/30 flex items-center justify-center shadow-inner group-hover:bg-green-900/30 transition-colors">
                                            <CheckCircle className="w-6 h-6 text-green-400 drop-shadow-[0_0_5px_rgba(74,222,128,0.5)]" />
                                        </div>
                                        <div>
                                            <h3 className="font-serif text-xl text-cream leading-tight drop-shadow-sm">Recently Approved</h3>
                                            <span className="text-[10px] uppercase tracking-widest text-green-400/80 font-medium block mt-1 drop-shadow-sm">
                                                {recentlyApproved.length} Live Items
                                            </span>
                                        </div>
                                    </div>

                                    {recentlyApproved.length === 0 ? (
                                        <div className="py-8 text-center text-cream/40 font-serif text-lg tracking-wide relative z-10">No recent approvals</div>
                                    ) : (
                                        <div className="space-y-3 relative z-10">
                                            {recentlyApproved.slice(0, 3).map((product) => (
                                                <div key={product._id} className="flex items-center gap-3 text-sm text-cream/80 bg-green-500/10 border border-green-500/20 p-3.5 rounded-xl shadow-inner backdrop-blur-md group-hover:bg-green-500/20 transition-colors">
                                                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 drop-shadow-[0_0_2px_currentColor]" />
                                                    <span className="truncate font-medium tracking-wide drop-shadow-sm">{product.name}</span>
                                                </div>
                                            ))}
                                            {recentlyApproved.length > 3 && (
                                                <div className="text-center font-mono text-[10px] uppercase tracking-widest text-cream/40 mt-3 bg-white/5 py-2 rounded-xl border border-white/5 shadow-inner">
                                                    + {recentlyApproved.length - 3} more
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </FadeIn>

                            {/* Rejected - Glass Panel */}
                            <FadeIn delay={500}>
                                <div className="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-[2rem] p-6 shadow-[0_15px_30px_rgba(0,0,0,0.3)] relative overflow-hidden group">
                                    <div className="absolute inset-0 border border-white/5 mix-blend-overlay rounded-[2rem] pointer-events-none z-0"></div>
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none z-0"></div>

                                    <div className="flex items-center gap-4 mb-6 relative z-10">
                                        <div className="w-12 h-12 rounded-2xl bg-red-900/20 backdrop-blur-md border border-red-500/30 flex items-center justify-center shadow-inner group-hover:bg-red-900/30 transition-colors">
                                            <AlertTriangle className="w-6 h-6 text-red-400 drop-shadow-[0_0_5px_rgba(248,113,113,0.5)]" />
                                        </div>
                                        <div>
                                            <h3 className="font-serif text-xl text-cream leading-tight drop-shadow-sm">Requires Attention</h3>
                                            <span className="text-[10px] uppercase tracking-widest text-red-400/80 font-medium block mt-1 drop-shadow-sm">
                                                {rejectedProducts.length} Issues Found
                                            </span>
                                        </div>
                                    </div>

                                    {rejectedProducts.length === 0 ? (
                                        <div className="py-8 text-center text-cream/40 font-serif text-lg tracking-wide relative z-10">No issues found</div>
                                    ) : (
                                        <div className="space-y-4 relative z-10 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                            {rejectedProducts.map((product) => (
                                                <div key={product._id} className="group/item bg-white/5 border border-white/10 p-5 rounded-2xl backdrop-blur-md hover:bg-white/10 hover:border-red-500/30 transition-all shadow-inner hover:shadow-[0_5px_15px_rgba(248,113,113,0.1)]">
                                                    {/* Header with image and name */}
                                                    <div className="flex items-start gap-4 mb-4">
                                                        {/* Image Preview */}
                                                        <div className="h-16 w-16 rounded-xl bg-black/60 backdrop-blur-sm border border-white/10 overflow-hidden flex-shrink-0 relative shadow-inner">
                                                            {product.images && product.images[0] && !failedImages.has(product._id) ? (
                                                                <SafeImage
                                                                    src={product.images[0]}
                                                                    alt=""
                                                                    className="h-full w-full object-cover opacity-90 group-hover/item:opacity-100 transition-opacity"
                                                                    onError={() => {
                                                                        setFailedImages(prev => new Set(prev).add(product._id));
                                                                    }}
                                                                />
                                                            ) : (
                                                                <div className="h-full w-full flex items-center justify-center text-red-400/50">
                                                                    <Package className="w-6 h-6" />
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="flex-1 min-w-0 pt-1">
                                                            <h4 className="font-medium text-cream text-sm truncate font-serif leading-tight mb-2 drop-shadow-sm">{product.name}</h4>

                                                            {/* CJ Info */}
                                                            {product.cjSourcingId && (
                                                                <div className="flex items-center gap-1.5 font-mono text-[10px] text-red-400 bg-red-900/30 border border-red-500/20 px-2.5 py-1 rounded-lg w-fit shadow-inner">
                                                                    <Link2 className="w-3 h-3 drop-shadow-[0_0_2px_currentColor]" />
                                                                    CJ ID: {product.cjSourcingId.slice(-12)}...
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Error Message */}
                                                    <div className="flex items-start gap-3 p-3 bg-red-900/20 border border-red-500/20 rounded-xl mb-4 shadow-inner">
                                                        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 drop-shadow-[0_0_3px_currentColor]" />
                                                        <p className="text-[11px] font-mono tracking-wide text-red-300/90 leading-relaxed break-words">
                                                            {product.cjSourcingError || 'Rejected by CJ - no specific reason provided'}
                                                        </p>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-white/5">
                                                        {/* Resubmit */}
                                                        <button
                                                            onClick={() => handleResubmit(product._id)}
                                                            disabled={resubmittingId === product._id}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 active:bg-amber-500/30 rounded-lg transition-all disabled:opacity-50 shadow-inner uppercase tracking-widest"
                                                            title="Retry submission to CJ"
                                                        >
                                                            {resubmittingId === product._id ? (
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin drop-shadow-[0_0_2px_currentColor]" />
                                                            ) : (
                                                                <RotateCcw className="w-3.5 h-3.5 drop-shadow-[0_0_2px_currentColor]" />
                                                            )}
                                                            Retry
                                                        </button>

                                                        {/* Source URL */}
                                                        {product.sourceUrl && (
                                                            <a
                                                                href={product.sourceUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-cream/40 hover:text-cream hover:bg-white/10 rounded-lg transition-all border border-transparent hover:border-white/10"
                                                                title="View source"
                                                            >
                                                                <ExternalLink className="w-3.5 h-3.5" />
                                                            </a>
                                                        )}

                                                        {/* Delete */}
                                                        <button
                                                            onClick={() => handleDeleteProduct(product._id, product.name, product.cjSourcingId)}
                                                            disabled={deletingId === product._id}
                                                            className="p-1.5 text-red-400/70 hover:text-red-400 active:text-red-400 hover:bg-red-500/20 active:bg-red-500/30 rounded-lg transition-all disabled:opacity-50 border border-transparent hover:border-red-500/30"
                                                            title="Remove from catalog"
                                                        >
                                                            {deletingId === product._id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-4 h-4 drop-shadow-[0_0_2px_currentColor]" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </FadeIn>

                        </div>
                    </div>
                </div>
            </div>

            {/* Size Variant Mapping Section */}
            <div className="mt-16 relative z-10">
                <FadeIn delay={550}>
                    <h2 className="font-serif text-3xl text-cream drop-shadow-md mb-8 flex items-center gap-3">
                        <Package className="w-6 h-6 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
                        Variant Mapping
                    </h2>
                </FadeIn>
                <div className="w-full">
                    {/* The CJVariantManager creates its own dark-glass wrapper internally if needed, but we provide it full width and context */}
                    <CJVariantManager />
                </div>
            </div>

            {/* Knowledge Base / Footer Info */}
            <FadeIn delay={700} className="mt-24 pt-10 border-t border-white/10 relative z-10 relative">
                <div className="absolute inset-0 bg-gradient-to-t from-white/5 to-transparent mix-blend-overlay pointer-events-none"></div>
                <div className="flex flex-col md:flex-row gap-8 lg:gap-12 text-xs md:text-sm text-cream/60 leading-relaxed font-sans backdrop-blur-3xl bg-black/40 p-8 md:p-12 rounded-[2rem] border border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.4)] relative overflow-hidden">
                    <div className="absolute inset-0 bg-noise opacity-[0.03] mix-blend-overlay pointer-events-none"></div>
                    <div className="flex-1 relative z-10">
                        <strong className="flex items-center gap-2 text-amber-400 uppercase tracking-widest mb-3 font-medium drop-shadow-sm text-[10px] md:text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_5px_#fbbf24]"></span>
                            Automated Workflow
                        </strong>
                        <p className="font-light">Products imported from AliExpress are automatically submitted to CJ for sourcing. They remain "Pending" and hidden from the storefront until CJ approves the sourcing request. Once approved, they automatically go live.</p>
                    </div>
                    <div className="flex-1 relative z-10">
                        <strong className="flex items-center gap-2 text-amber-400 uppercase tracking-widest mb-3 font-medium drop-shadow-sm text-[10px] md:text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_5px_#fbbf24]"></span>
                            CJ Sourcing ID
                        </strong>
                        <p className="font-light">If CJ provides a new SKU or Variant ID, the system will link it. Pricing is not automatically synced - please review the imported cost in CJ before setting your retail price.</p>
                    </div>
                    <div className="flex-1 relative z-10">
                        <strong className="flex items-center gap-2 text-amber-400 uppercase tracking-widest mb-3 font-medium drop-shadow-sm text-[10px] md:text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_5px_#fbbf24]"></span>
                            Troubleshooting
                        </strong>
                        <p className="font-light">If products stick in "Pending" for more than 48 hours, use "Check Sourcing" above. For "Failed" items, verify the AliExpress URL is valid and accessible publicly.</p>
                    </div>
                </div>
            </FadeIn>

            {/* Custom Scrollbar Styles for this component only */}
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: rgba(255,255,255,0.02);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255,255,255,0.1);
                    border-radius: 10px;
                    border: 1px solid rgba(255,255,255,0.05);
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255,255,255,0.2);
                }
            `}</style>
        </div>
    );
};
