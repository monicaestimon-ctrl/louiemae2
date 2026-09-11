import { sanitizeAiWarning } from '../../lib/aiProviderErrors';
import React, { useEffect, useRef, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { Product } from '../../types';
import { buildSourceProductSnapshot, type SmartDescriptionResponse } from '../../lib/smartDescription';
import { isProductSourceAttribute, semanticGenerationKey, type GenerationSelection, type SourceContext } from '../../lib/productGeneration';
import { getUserFacingErrorMessage } from '../../lib/errorMessages';

export type CopyDraft = Pick<Product, 'name' | 'description' | 'smartDescription' | 'descriptionSource' | 'pendingNameClaimId' | 'nameOwnerKey' | 'sourceSnapshotId' | 'sourceEvidenceOverrides' | 'sourceScopeStatus'>;
export function descriptionMetadata(result: SmartDescriptionResponse): Product['smartDescription'] {
    if (!result.auditId || !result.description || !result.model || !result.promptVersion || !result.sourceSnapshotHash) return undefined;
    return { description: result.description, auditId: result.auditId as Id<'descriptionAudits'>, generatedAt: Date.now(), model: result.model,
        promptVersion: result.promptVersion, sourceSnapshotHash: result.sourceSnapshotHash, adminEdited: false, status: result.fallbackUsed ? 'fallback' : 'generated' };
}
export type DetailsAndStoryActions = { generateName: () => void; generateDescription: () => void };
type Props = { actionsRef?: React.Ref<DetailsAndStoryActions>; value: CopyDraft; context: SourceContext; selection: GenerationSelection; onChange: (value: CopyDraft) => void;
    productId?: Id<'products'>; revision?: number; newListing?: boolean; dark?: boolean; onBusyChange?: (busy: boolean) => void; children?: React.ReactNode; initialSuggestion?: SmartDescriptionResponse; onAvailableImages?: (images: string[]) => void };

/** The same import-studio controls and request lifecycle in every entry point. */
export function DetailsAndStory({ value, context, selection, onChange, productId, revision, newListing, dark, onBusyChange, children, initialSuggestion, onAvailableImages, actionsRef }: Props) {
    const nameAction = useAction(api.smartNames.generateSmartName);
    const descriptionAction = useAction(api.smartDescriptions.generateSmartDescription);
    const sourceAction = useAction(api.productSourceActions.refresh);
    const source = useQuery(api.productSources.preview, value.sourceSnapshotId ? { id: value.sourceSnapshotId } : 'skip');
    const imageCallback = useRef(onAvailableImages); imageCallback.current = onAvailableImages;
    useEffect(() => {
        if (source?.snapshot) imageCallback.current?.([...source.snapshot.images, ...(source.snapshot.descriptionImages ?? [])].map((image: { url: string }) => image.url));
    }, [source?._id]);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [warnings, setWarnings] = useState<string[]>([]);
    const [suggestion, setSuggestion] = useState<SmartDescriptionResponse | null>(initialSuggestion ?? null);
    const [diagnostic, setDiagnostic] = useState<SmartDescriptionResponse>();
    const [quality, setQuality] = useState<number>();
    const signature = semanticGenerationKey({ value, context, selection, revision, productId });
    const latest = useRef(signature); latest.current = signature;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { setSuggestion(initialSuggestion ?? null); }, [initialSuggestion]);
    const previousSignature = useRef(signature);
    useEffect(() => { if (previousSignature.current !== signature) setSuggestion(null); previousSignature.current = signature; }, [signature]);
    const evidence = value.sourceEvidenceOverrides ?? {};
    const start = (message: string) => { setBusy(message); setError(''); setSuggestion(null); onBusyChange?.(true); };
    const finish = () => { if (mounted.current) { setBusy(''); onBusyChange?.(false); } };
    const valid = () => mounted.current && latest.current === signature;
    function applyDescription(result: SmartDescriptionResponse, sourceId?: Id<'productSourceSnapshots'>) {
        if (!result.description || !result.auditId) return;
        onChange({ ...value, sourceSnapshotId: sourceId ?? value.sourceSnapshotId, description: result.description, descriptionSource: result.fallbackUsed ? 'safe_fallback' : 'ai_generated', smartDescription: descriptionMetadata(result) });
    }
    async function loadSource() {
        if (!context.sourceUrl) return;
        start('Loading supplier details…');
        try {
            const result = await sourceAction({ url: context.sourceUrl, refresh: Boolean(value.sourceSnapshotId), productId });
            if (!valid()) return;
            setWarnings(result.warnings ?? []);
            onChange({ ...value, sourceSnapshotId: result.sourceSnapshotId });
        } catch (err) { if (valid()) setError(getUserFacingErrorMessage(err, 'Supplier details could not be loaded. Your description has been kept.')); }
        finally { finish(); }
    }
    React.useImperativeHandle(actionsRef, () => ({ generateName: () => { void generate('name'); }, generateDescription: () => { void generate('description'); } }));
    async function generate(kind: 'name' | 'description') {
        if (busy || diagnostic?.providerRetryable === false) return;
        start(!value.sourceSnapshotId && context.sourceUrl ? 'Loading supplier details…' : 'Generating…');
        try {
            let sourceId = value.sourceSnapshotId;
            if (!sourceId && context.sourceUrl) {
                try {
                    const loaded = await sourceAction({ url: context.sourceUrl, refresh: false, productId });
                    if (!valid()) return;
                    sourceId = loaded.sourceSnapshotId; setWarnings(loaded.warnings);
                } catch { setWarnings(['Supplier details could not be loaded. Generating with available facts and selected photos.']); }
            }
            setBusy(kind === 'name' ? 'Generating name…' : 'Generating description…');
            const request = { productId, sourceSnapshotId: sourceId, ownerKey: value.nameOwnerKey,
                sourceSnapshot: buildSourceProductSnapshot({ sourceUrl: context.sourceUrl, name: selection.variants.map(v => v.name).join(', '), images: selection.images,
                    rawDescription: evidence.facts, variants: selection.variants }),
                selection: { ...selection, evidence }, context,
                adminContext: { selectedCategory: context.category, selectedSubcategory: context.subcategory, selectedSubcategoryIds: context.subcategoryIds,
                    selectedCollection: context.collection, audience: context.audience }, generationMode: 'manual_generate',
                options: { allowImageAnalysis: true, allowSeoKeywords: true, forceFreshVariation: true } };
            if (kind === 'name') {
                const result = await nameAction({ request });
                if (!valid()) return;
                setWarnings(result.warnings ?? []);
                if (!result.ok || !result.name) throw new Error(result.error || 'Name generation failed.');
                if (result.fallbackUsed) setWarnings(current => [...current, 'A limited name suggestion was used. Review it before saving.']);
                onChange({ ...value, sourceSnapshotId: sourceId, name: result.name, pendingNameClaimId: result.claimId as Id<'productNameClaims'>, nameOwnerKey: result.ownerKey });
            } else {
                const result = await descriptionAction({ request });
                if (!valid()) return;
                setWarnings(result.warnings ?? []); setDiagnostic(result); setQuality(result.facts?.sourceQuality.score);
                if (!result.ok || !result.description) throw new Error(result.error || 'AI generation is unavailable. Your description has been kept.');
                if (result.fallbackUsed || !result.validation.passed) setSuggestion({ ...result, sourceSnapshotId: sourceId });
                else applyDescription(result, sourceId);
            }
        } catch (err) { if (valid()) setError(getUserFacingErrorMessage(err, 'Generation failed. Your description has been kept.')); }
        finally { finish(); }
    }
    const fieldClass = `w-full rounded-lg border p-3 text-sm ${dark ? 'border-white/20 bg-black/40 text-cream' : 'border-white/40 bg-white/60 text-earth'}`;
    const buttonClass = `min-h-11 rounded-lg border px-3 text-sm ${dark ? 'border-purple-400/40 text-purple-200' : 'border-purple-200 text-purple-700'}`;
    return <fieldset disabled={Boolean(busy)} className={`min-w-0 space-y-4 ${dark ? 'text-cream' : 'text-earth'}`}>
        <div className="space-y-2">
            <label className="block text-sm">{newListing ? 'New product name' : 'Product name'}
                <input className={fieldClass} value={value.name} onChange={event => onChange({ ...value, name: event.target.value, pendingNameClaimId: undefined, nameOwnerKey: undefined })} />
            </label>
            <button className={buttonClass} type="button" onClick={() => generate('name')}>Smart Name</button>
        </div>
        {children}
        <div className="space-y-2">
            <label className="block text-sm">Product description
                <textarea rows={6} className={fieldClass} value={value.description} onChange={event => onChange({ ...value, description: event.target.value,
                    descriptionSource: value.smartDescription ? 'ai_generated_admin_edited' : 'admin_written',
                    smartDescription: value.smartDescription ? { ...value.smartDescription, adminEdited: true, status: 'edited' } : undefined })} />
            </label>
            <button className={buttonClass} disabled={diagnostic?.providerRetryable === false} type="button" onClick={() => generate('description')}>Smart Description</button>
        </div>
        <div className="rounded-lg border border-purple-300/30 p-3 text-sm">
            {context.sourceUrl && <a href={context.sourceUrl} target="_blank" rel="noreferrer" className="block truncate underline">View supplier listing</a>}
            <p>Supplier details: {source ? source.status === 'complete' ? 'Loaded' : 'Partially loaded' : 'Not loaded yet'}</p>
            {source?.fetchedAt && <p>Last loaded: {new Date(source.fetchedAt).toLocaleString()}</p>}
            {context.sourceUrl ? <button type="button" className={buttonClass} onClick={loadSource}>{value.sourceSnapshotId ? 'Refresh supplier details' : 'Load supplier details'}</button> : <p>Add a supplier URL or confirmed facts to provide more detail.</p>}
            <details className="mt-3"><summary>Review supplier facts for this product</summary>
                {selection.subset && <p className="my-2">This supplier listing contains separate products. Confirm only facts that apply to this selection.</p>}
                {source?.snapshot?.attributes?.filter(isProductSourceAttribute).map((attribute: { key: string; value: string }, index: number) => <label key={`${attribute.key}_${index}`} className="my-2 block">
                    {selection.subset && <input type="checkbox" checked={evidence.attributeKeys?.includes(attribute.key) ?? false}
                        onChange={event => onChange({ ...value, sourceScopeStatus: selection.subset ? 'confirmed_subset' : value.sourceScopeStatus, sourceEvidenceOverrides: { ...evidence, attributeKeys: event.target.checked ? [...(evidence.attributeKeys ?? []), attribute.key] : evidence.attributeKeys?.filter(key => key !== attribute.key) } })} />}
                    {' '}{attribute.key}: {attribute.value}
                </label>)}
                {source?.snapshot?.rawDescription && <p className="my-2 max-h-48 overflow-auto whitespace-pre-wrap">{source.snapshot.rawDescription}</p>}
                {selection.subset && <label className="my-2 block"><input type="checkbox" checked={Boolean(evidence.useDescription)} onChange={event => onChange({ ...value, sourceScopeStatus: selection.subset ? 'confirmed_subset' : value.sourceScopeStatus, sourceEvidenceOverrides: { ...evidence, useDescription: event.target.checked } })} /> The supplier description applies to this selected product</label>}
                <label className="mt-2 block">Confirmed details for this product<textarea rows={3} className={fieldClass} value={evidence.facts ?? ''}
                    onChange={event => onChange({ ...value, sourceScopeStatus: selection.subset ? 'confirmed_subset' : value.sourceScopeStatus, sourceEvidenceOverrides: { ...evidence, facts: event.target.value } })} placeholder="Add verified design, fabric, fit, or other product details." /></label>
            </details>
        </div>
        {busy && <p role="status">{busy}</p>}
        {error && <p role="alert" className={dark ? 'text-amber-200' : 'text-amber-800'}>{error}</p>}
        {quality !== undefined && <p className="text-xs">Source quality: {quality}/100</p>}
        {[...new Set([...(source?.warnings ?? []), ...warnings])].map(warning => <p key={warning} className={`text-xs ${dark ? 'text-amber-200' : 'text-amber-800'}`}>{sanitizeAiWarning(warning)}</p>)}
        {diagnostic && <details className="text-xs"><summary>Generation details</summary>
            <p>Model: {diagnostic.model}</p><p>Audit: {diagnostic.auditId}</p><p>Source snapshot: {diagnostic.sourceSnapshotId}</p>
            {diagnostic.providerErrorCode && <p>Provider status: {diagnostic.providerErrorCode}</p>}
            {diagnostic.providerRetryable === false && <p>Restore provider access, then reload this page before trying again.</p>}
        </details>}
        {suggestion && <div className="rounded-lg border border-amber-400/40 p-3">
            <p className="font-medium">Limited draft available — your description has been kept.</p>
            <p className="my-2 whitespace-pre-wrap">{suggestion.description}</p>
            <button type="button" className={buttonClass} onClick={() => { applyDescription(suggestion, suggestion.sourceSnapshotId as Id<'productSourceSnapshots'>); setSuggestion(null); }}>Use this draft</button>
        </div>}
    </fieldset>;
}
