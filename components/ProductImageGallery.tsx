import React from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { SafeImage } from './SafeImage';

interface ProductImageGalleryProps {
    /** Ordered list of image URLs to display */
    images: string[];
    /** Currently active image index */
    activeIndex: number;
    /** Callback when the active index changes */
    onIndexChange: (index: number) => void;
    /** Alt text for the main image */
    alt?: string;
    /** Show the green "main listing image" badge on index 0 */
    showMainBadge?: boolean;
    /** Show the scrollable thumbnail strip below the main image */
    showThumbnails?: boolean;
}

/** Reusable image gallery with nav arrows, counter badge, and clickable thumbnails. */
export const ProductImageGallery: React.FC<ProductImageGalleryProps> = ({
    images,
    activeIndex,
    onIndexChange,
    alt = 'Product image',
    showMainBadge = true,
    showThumbnails = true,
}) => {
    if (images.length === 0) return null;

    const displayIdx =
        Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < images.length
            ? activeIndex
            : 0;

    const goPrev = () => onIndexChange(displayIdx <= 0 ? images.length - 1 : displayIdx - 1);
    const goNext = () => onIndexChange(displayIdx >= images.length - 1 ? 0 : displayIdx + 1);

    return (
        <div className="space-y-2">
            {/* Main image with nav arrows */}
            <div className="aspect-square rounded-xl overflow-hidden border border-earth/10 relative group">
                <SafeImage
                    src={images[displayIdx]}
                    alt={alt}
                    className="w-full h-full object-cover"
                />
                {showMainBadge && displayIdx === 0 && (
                    <div className="absolute top-2 left-2 bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center" title="Main listing image">
                        <Check className="w-3 h-3" />
                    </div>
                )}
                {images.length > 1 && (
                    <>
                        <button
                            type="button"
                            onClick={goPrev}
                            aria-label="Previous image"
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur hover:bg-white text-earth/60 hover:text-earth rounded-full w-7 h-7 flex items-center justify-center shadow-md opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={goNext}
                            aria-label="Next image"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur hover:bg-white text-earth/60 hover:text-earth rounded-full w-7 h-7 flex items-center justify-center shadow-md opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur px-2 py-0.5 rounded-full text-[10px] font-medium text-earth/60 shadow-sm">
                            {displayIdx + 1} / {images.length}
                        </div>
                    </>
                )}
            </div>
            {/* Scrollable clickable thumbnail strip */}
            {showThumbnails && images.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {images.map((img, i) => (
                        <button
                            type="button"
                            key={i}
                            onClick={() => onIndexChange(i)}
                            className={`w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${displayIdx === i ? 'border-bronze ring-1 ring-bronze/30 scale-105' : 'border-earth/10 hover:border-earth/30'}`}
                        >
                            <SafeImage src={img} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
