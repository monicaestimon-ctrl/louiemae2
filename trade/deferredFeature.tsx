import React, { lazy, Suspense, type ComponentType } from 'react';
import { LoadingFeature } from './LoadingFeature';

/** Defer optional tools until opened, with a local recovery boundary. */
export function deferredFeature<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, label: string) {
  return class DeferredFeature extends React.Component<P, { failed: boolean }> {
    state = { failed: false };
    private Feature = lazy(load);
    static getDerivedStateFromError() { return { failed: true }; }
    private retry = () => {
      this.Feature = lazy(load);
      this.setState({ failed: false });
    };
    render() {
      if (this.state.failed) return <section role="alert" aria-label={label}>
        <p>{label} could not load. Please try again.</p>
        <button type="button" onClick={this.retry}>Try loading again</button>
        <p>If this continues, reload the page to get the latest version.</p>
      </section>;
      const Feature = this.Feature;
      return <Suspense fallback={<LoadingFeature label={label} retry={this.retry} />}>
        <Feature {...this.props} />
      </Suspense>;
    }
  };
}
