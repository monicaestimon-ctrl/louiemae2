import React from 'react';

/** Explain optional-data failure and expose an explicit retry without a page reload. */
export function SectionUnavailable({ label, retry }: { label: string; retry: () => void }) {
  return <div role="status" className="p-6 text-center text-earth">
    <p>{label} are temporarily unavailable.</p>
    <button className="mt-4 min-h-11 border border-earth px-5 py-3" onClick={retry}>Try again</button>
  </div>;
}

/** Retry an optional section without removing surrounding content or user input. */
export class SectionBoundary extends React.Component<{ label: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  /** Do not expose transport error messages or mark an unavailable section as loaded. */
  render() {
    if (!this.state.failed) return this.props.children;
    return <SectionUnavailable label={this.props.label} retry={() => this.setState({ failed: false })} />;
  }
}
