import React, { lazy, Suspense, type ComponentType } from 'react';
import { LoadingFeature } from './LoadingFeature';

/** Defer optional tools until opened, with a local recovery boundary. */
export function deferredFeature<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, label: string, renderFallback: (content: React.ReactNode, props: P) => React.ReactNode = content => content) {
  return class DeferredFeature extends React.Component<P, { failed: boolean; attempt: number }> {
    state = { failed: false, attempt: 0 };
    private Feature = lazy(load);
    static getDerivedStateFromError() { return { failed: true }; }
    private retry = () => {
      this.Feature = lazy(load);
      this.setState(previous => ({ failed: false, attempt: previous.attempt + 1 }));
    };
    render() {
      if (this.state.failed) return renderFallback(<section role="alert" aria-label={label}>
        <p>{label} could not load. Please try again.</p>
        <button type="button" onClick={this.retry}>Try loading again</button>
        <button type="button" onClick={() => window.location.reload()}>Reload page</button>
      </section>, this.props);
      const Feature = this.Feature;
      return <Suspense fallback={renderFallback(<LoadingFeature key={this.state.attempt} label={label} retry={this.retry} />, this.props)}>
        <Feature {...this.props} />
      </Suspense>;
    }
  };
}
