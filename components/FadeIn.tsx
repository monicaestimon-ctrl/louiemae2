import React, { useRef, useState, useEffect } from 'react';

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  threshold?: number;
  /** On mobile (<768px), use a quick subtle fade with no translate shift */
  mobileFast?: boolean;
}

export const FadeIn: React.FC<FadeInProps> = ({
  children,
  delay = 0,
  className = "",
  threshold = 0.1,
  mobileFast = false,
}) => {
  const domRef = useRef<HTMLDivElement>(null);
  const [isVisible, setVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (mobileFast) {
      const mql = window.matchMedia('(max-width: 767px)');
      setIsMobile(mql.matches);
      const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
  }, [mobileFast]);

  // On mobile with mobileFast, use near-zero threshold so even a tiny scroll triggers the fade
  const effectiveThreshold = (mobileFast && isMobile) ? 0.005 : threshold;

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const fallback = window.setTimeout(() => {
      setVisible(true);
    }, Math.max(700, delay + 300));

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setVisible(true);
          window.clearTimeout(fallback);
          if (domRef.current) observer.unobserve(domRef.current);
        }
      });
    }, { threshold: effectiveThreshold });

    const currentRef = domRef.current;
    if (currentRef) observer.observe(currentRef);

    return () => {
      window.clearTimeout(fallback);
      if (currentRef) observer.unobserve(currentRef);
    };
  }, [delay, effectiveThreshold]);

  // Mobile fast: quick 300ms opacity fade, no vertical shift
  const useFastFade = mobileFast && isMobile;

  return (
    <div
      ref={domRef}
      className={`ease-out transform ${useFastFade
        ? `transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`
        : `transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-16'}`
        } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};
