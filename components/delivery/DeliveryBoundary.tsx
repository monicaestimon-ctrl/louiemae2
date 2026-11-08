import React from 'react';
/** A stale product or mistyped private record ID must not take down the storefront/admin page. */
export default class DeliveryBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert" className="border p-3 text-sm">
        <p>
          This delivery record changed or is unavailable. Refresh this section to check the latest
          details.
        </p>
        <button type="button" onClick={() => this.setState({ failed: false })}>
          Refresh delivery section
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
