import React, { useState } from 'react';
import { SafeImage } from './SafeImage';

export function VariantImagePicker({ label, value, images, recommended, onChange }: {
    label: string; value?: string; images: string[]; recommended?: string; onChange: (image: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const choices = [...new Set([recommended, value, ...images].filter((url): url is string => Boolean(url)))];
    return <div className="mt-3 rounded-xl border border-white/10 p-3">
        <button type="button" aria-label={`Choose photo for ${label}`} aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 items-center gap-3 text-sm text-cream">
            {value && <SafeImage src={value} alt={`Selected photo for ${label}`} className="h-16 w-12 rounded object-cover" />}
            Choose photo for {label}
        </button>
        {open && <div>
            <p className="my-2 text-xs text-cream/60">Choose from saved import photos and CJ photos. This links the photo to this customer option.</p>
            <div className="flex max-h-64 flex-wrap gap-2 overflow-auto">{choices.map((url, index) => <button key={url} type="button"
                aria-label={`Photo ${index + 1} for ${label}${url === recommended ? ' (CJ match)' : ''}`} aria-pressed={value === url}
                onClick={() => onChange(url)} className={`w-24 rounded-lg border-2 p-1 ${value === url ? 'border-purple-400' : 'border-white/10'}`}>
                <SafeImage src={url} alt="" className="h-24 w-full rounded object-cover" />
                <span className="text-xs text-cream">{value === url ? 'Selected' : url === recommended ? 'CJ match' : `Photo ${index + 1}`}</span>
            </button>)}</div>
            {!choices.length && <p className="text-sm text-cream/60">No photos available yet.</p>}
        </div>}
    </div>;
}
