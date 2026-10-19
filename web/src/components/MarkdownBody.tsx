import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';

/** A formatted post body. In the feed it is cut to `maxHeight` with a fade and a "Show more" button. */
export function MarkdownBody({ source, className = '', clamp, onMore }: { source: string; className?: string; clamp?: boolean; onMore?: () => void }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const clamped = clamp && !open;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && clamped) setOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [html, clamped]);
  return (
    <div className={className}>
      <div ref={ref} className={`md ${clamped ? 'max-h-[19rem] overflow-hidden' : ''} ${clamped && overflows ? '[mask-image:linear-gradient(to_bottom,black_75%,transparent)]' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
      {clamped && overflows && (
        <button className="mt-1 text-sm font-medium text-accent-text hover:underline" onClick={() => (onMore ? onMore() : setOpen(true))}>
          Show more
        </button>
      )}
    </div>
  );
}
