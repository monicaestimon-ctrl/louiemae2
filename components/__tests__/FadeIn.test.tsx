import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FadeIn } from '../FadeIn';

// Mock IntersectionObserver
beforeEach(() => {
    class MockIntersectionObserver implements IntersectionObserver {
        root: Element | null = null;
        rootMargin: string = '';
        thresholds: ReadonlyArray<number> = [];

        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn().mockReturnValue([]);
    }

    window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

describe('FadeIn', () => {
    it('renders children correctly', () => {
        render(
            <FadeIn>
                <span>Test Content</span>
            </FadeIn>
        );

        expect(screen.getByText('Test Content')).toBeInTheDocument();
        expect(screen.getByText('Test Content').parentElement).toHaveClass('opacity-100');
        expect(screen.getByText('Test Content').parentElement).not.toHaveClass('opacity-0');
    });

    it('applies custom className', () => {
        render(
            <FadeIn className="custom-class">
                <span>Test Content</span>
            </FadeIn>
        );

        const container = screen.getByText('Test Content').parentElement;
        expect(container).toHaveClass('custom-class');
    });

    it('applies transition delay style', () => {
        render(
            <FadeIn delay={500}>
                <span>Test Content</span>
            </FadeIn>
        );

        const container = screen.getByText('Test Content').parentElement;
        expect(container).toHaveStyle({ transitionDelay: '500ms' });
    });
});
