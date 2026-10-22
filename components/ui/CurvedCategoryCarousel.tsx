"use client";

import React, { useRef, useState, useEffect } from 'react';
import { responsiveImage } from '../../lib/responsiveImage';

interface CategoryItem {
    id: string;
    title: string;
    image: string;
    caption?: string;
    redirect?: string;
}

interface CurvedCategoryCarouselProps {
    categories: CategoryItem[];
    onCategoryClick: (category: CategoryItem) => void;
    title?: string;
    subtitle?: string;
}

/**
 * A horizontally scrollable category carousel with 3D curved perspective effect.
 * Features:
 * - 3D inverted curvature (edge cards tilt inward)
 * - Horizontal scroll with peek effect (shows partial cards on edges)
 * - Works with any number of categories
 * - Premium hover effects with image zoom and text reveal
 */
export const CurvedCategoryCarousel: React.FC<CurvedCategoryCarouselProps> = ({
    categories,
    onCategoryClick,
    title,
    subtitle,
}) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [scrollProgress, setScrollProgress] = useState(0);
    const [visibleCards, setVisibleCards] = useState<number[]>([]);

    // Track scroll position for dynamic curvature
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollLeft, scrollWidth, clientWidth } = container;
            const maxScroll = scrollWidth - clientWidth;
            setScrollProgress(maxScroll > 0 ? scrollLeft / maxScroll : 0);

            // Calculate which cards are currently visible
            const cardElements = container.querySelectorAll('[data-card-index]');
            const containerRect = container.getBoundingClientRect();
            const visible: number[] = [];

            cardElements.forEach((card) => {
                const cardRect = card.getBoundingClientRect();
                const cardCenter = cardRect.left + cardRect.width / 2;
                if (cardCenter >= containerRect.left && cardCenter <= containerRect.right) {
                    visible.push(parseInt(card.getAttribute('data-card-index') || '0'));
                }
            });

            setVisibleCards(visible);
        };

        container.addEventListener('scroll', handleScroll);
        handleScroll(); // Initial call

        return () => container.removeEventListener('scroll', handleScroll);
    }, [categories.length]);

    // Calculate 3D transform for each card based on its position
    const getCardTransform = (index: number) => {
        const container = scrollContainerRef.current;
        if (!container) return {};

        const containerRect = container.getBoundingClientRect();
        const containerCenter = containerRect.width / 2;

        // Get card element position
        const cardElement = container.querySelector(`[data-card-index="${index}"]`) as HTMLElement;
        if (!cardElement) return {};

        const cardRect = cardElement.getBoundingClientRect();
        const cardCenter = cardRect.left - containerRect.left + cardRect.width / 2 + container.scrollLeft;
        const viewportCardCenter = cardRect.left - containerRect.left + cardRect.width / 2;

        // Calculate offset from center of viewport
        const offsetFromCenter = (viewportCardCenter - containerCenter) / containerCenter;

        // Rotation: cards on left rotate right, cards on right rotate left
        const rotateY = offsetFromCenter * 12; // Max 12 degrees

        // Depth: cards further from center are pushed back
        const translateZ = Math.abs(offsetFromCenter) * -30;

        return {
            transform: `perspective(1200px) rotateY(${rotateY}deg) translateZ(${translateZ}px)`,
            transformStyle: 'preserve-3d' as const,
        };
    };

    return (
        <div className="w-full">
            {/* Header */}
            {(title || subtitle) && (
                <div className="text-center mb-8 md:mb-12 px-4">
                    {title && (
                        <h2 className="font-serif text-3xl md:text-4xl text-earth mb-3">{title}</h2>
                    )}
                    {subtitle && (
                        <p className="text-xs uppercase tracking-widest text-earth/50">{subtitle}</p>
                    )}
                </div>
            )}

            {/* Scrollable Carousel Container */}
            <div className="relative">
                {/* Peek fade effect - left */}
                <div className="absolute left-0 top-0 bottom-0 w-8 md:w-16 bg-gradient-to-r from-cream to-transparent z-10 pointer-events-none" />

                {/* Peek fade effect - right */}
                <div className="absolute right-0 top-0 bottom-0 w-8 md:w-16 bg-gradient-to-l from-cream to-transparent z-10 pointer-events-none" />

                {/* Scroll Container */}
                <div
                    ref={scrollContainerRef}
                    className="flex gap-4 md:gap-6 overflow-x-auto scrollbar-hide px-8 md:px-16 pb-4 scroll-smooth"
                    style={{
                        scrollSnapType: 'x mandatory',
                        WebkitOverflowScrolling: 'touch',
                        perspective: '1200px',
                    }}
                >
                    {categories.map((cat, idx) => {
                        // Static curvature based on position in list
                        // Reduced rotation for more subtle effect - max 12 degrees total
                        const centerIdx = (categories.length - 1) / 2;
                        const offset = idx - centerIdx;
                        const rotateY = Math.max(-12, Math.min(12, offset * 4)); // 4 deg per step, capped at ±12
                        const translateZ = Math.min(0, Math.abs(offset) * -8); // Reduced depth

                        return (
                            <button
                                key={cat.id || idx}
                                data-card-index={idx}
                                onClick={() => onCategoryClick(cat)}
                                className="
                  group relative flex-shrink-0 overflow-hidden rounded-2xl
                  w-[200px] md:w-[280px] lg:w-[320px]
                  aspect-[3/4]
                  bg-stone-100 
                  shadow-lg hover:shadow-2xl
                  transition-all duration-500 ease-out
                  hover:scale-[1.02]
                  scroll-snap-align-center
                "
                                style={{
                                    transform: `rotateY(${rotateY}deg) translateZ(${translateZ}px)`,
                                    transformStyle: 'preserve-3d',
                                    scrollSnapAlign: 'center',
                                }}
                            >
                                {/* Image - fades in on load to prevent white flash */}
                                <img
                                    {...responsiveImage(cat.image, '(min-width: 768px) 33vw, 70vw')}
                                    loading="lazy"
                                    decoding="async"
                                    alt={cat.title}
                                    className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
                                    style={{ opacity: 0 }}
                                    onLoad={(e) => {
                                        (e.target as HTMLImageElement).style.opacity = '1';
                                    }}
                                />

                                {/* Gradient Overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

                                {/* Text Content - Centered */}
                                <div className="absolute inset-0 flex flex-col justify-end items-center text-center p-6 md:p-8">
                                    <h3 className="font-serif text-2xl md:text-3xl text-white font-light tracking-wide mb-2 whitespace-nowrap">
                                        {cat.title}
                                    </h3>
                                    <p className="text-white/70 text-xs md:text-sm uppercase tracking-[0.2em]">
                                        {cat.caption || 'Shop Now'}
                                    </p>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Scroll Indicator Dots */}
                {categories.length > 3 && (
                    <div className="flex justify-center gap-2 mt-6">
                        {categories.map((_, idx) => (
                            <button
                                key={idx}
                                onClick={() => {
                                    const container = scrollContainerRef.current;
                                    if (container) {
                                        const cardWidth = 200 + 16; // card width + gap (smaller cards)
                                        container.scrollTo({ left: idx * cardWidth, behavior: 'smooth' });
                                    }
                                }}
                                className={`w-2 h-2 rounded-full transition-all duration-300 ${visibleCards.includes(idx)
                                    ? 'bg-earth w-6'
                                    : 'bg-earth/30 hover:bg-earth/50'
                                    }`}
                                aria-label={`Go to card ${idx + 1}`}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CurvedCategoryCarousel;
