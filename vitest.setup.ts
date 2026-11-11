import '@testing-library/jest-dom/vitest';

// JSDOM only models controlled dialog lifecycle. Real browser tests verify
// top-layer inertness, keyboard containment and native Escape behavior.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
}
