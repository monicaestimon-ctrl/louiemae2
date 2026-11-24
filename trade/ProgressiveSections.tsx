import { memo, useEffect, useState, type ReactNode } from 'react';

type Section = { id: string; render: () => ReactNode };
const SectionContent = memo(function SectionContent({ render }: Pick<Section, 'render'>) {
  return render();
});
/** Commit noncritical sections separately so a large homepage does not monopolize one frame. */
export function ProgressiveSections({ sections }: { sections: readonly Section[] }) {
  const [count, setCount] = useState(1);
  useEffect(() => {
    if (count >= sections.length) return;
    let cancelled = false;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const next = () => {
        if (!cancelled) setCount((value) => value + 1);
      };
      if (window.requestIdleCallback) idle = window.requestIdleCallback(next, { timeout: 1000 });
      else timer = setTimeout(next, 16);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [count, sections.length]);
  return (
    <>
      {sections.slice(0, count).map((section) => (
        <SectionContent key={section.id} render={section.render} />
      ))}
    </>
  );
}
