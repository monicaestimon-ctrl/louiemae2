export type PlannerLabel = { className: string; x: number; y: number; text: string };
export function renderPlannerLabels(container: HTMLElement, labels: PlannerLabel[]) {
  container.replaceChildren(...labels.map(label => {
    const node = document.createElement('span');
    node.className = `pl-lab ${label.className}`;
    node.style.left = `${label.x}px`;
    node.style.top = `${label.y}px`;
    node.textContent = label.text;
    return node;
  }));
}

export function calibrationScale(realLength: number, pixels: number): number | null {
  const scale = realLength / pixels;
  return Number.isFinite(realLength) && realLength > 0 && Number.isFinite(pixels) && pixels > 0
    && Number.isFinite(scale) && scale > 0 ? scale : null;
}

export async function usingDisposable<T extends { dispose?: () => void }, R>(create: () => T, operation: (resource: T) => Promise<R> | R): Promise<R> {
  const resource = create();
  try { return await operation(resource); } finally { resource.dispose?.(); }
}

export async function withRestoredVisibility<R>(hidden: { visible: boolean }[], render: () => Promise<R>): Promise<R> {
  try { return await render(); } finally { for (const object of hidden) object.visible = true; }
}

export async function renderAtRevision<R>(revision: () => number, render: () => Promise<R>): Promise<R | null> {
  const started = revision();
  const result = await render();
  return revision() === started ? result : null;
}
