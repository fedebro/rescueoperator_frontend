'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, Send, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
import { KeyboardAwareScreen } from '@/components/ui/keyboard-aware-screen';
import { Textarea } from '@/components/ui/textarea';
import { TimeAgo } from '@/components/ui/time-ago';
import { VirtualList, type VirtualListHandle } from '@/components/ui/virtual-list';

interface Line {
  id: number;
  text: string;
  at: string;
}

/**
 * The living-style-guide demo of the chat primitives (study 09 §3): a full-screen `KeyboardAwareScreen` whose body is a
 * reverse `VirtualList` with "load earlier" and "new messages below", and whose footer is the `Textarea` composer.
 */
export function KeyboardDemo() {
  const t = useTranslations('design.keyboard');
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <p className="text-muted text-sm">{t('intro')}</p>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="keyboard-demo-open">
        {t('open')}
      </Button>
      {open ? <KeyboardDemoScreen onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const line = (id: number, now: number): Line => ({
  id,
  text: `Messaggio numero ${id}`,
  at: new Date(now - (400 - id) * 90_000).toISOString(),
});

function KeyboardDemoScreen({ onClose }: { onClose: () => void }) {
  const t = useTranslations('design.keyboard');
  const [now] = React.useState(() => Date.now());
  const [lines, setLines] = React.useState<Line[]>(() =>
    Array.from({ length: 60 }, (_, i) => line(340 + i, now)),
  );
  const [loading, setLoading] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [newBelow, setNewBelow] = React.useState(0);
  const list = React.useRef<VirtualListHandle>(null);
  const hasMore = lines[0]!.id > 1;
  const loadEarlier = () => {
    setLoading(true);
    setTimeout(() => {
      setLines((current) => {
        const first = current[0]!.id;
        const from = Math.max(1, first - 40);
        return [...Array.from({ length: first - from }, (_, i) => line(from + i, now)), ...current];
      });
      setLoading(false);
    }, 500);
  };
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setLines((current) => [
      ...current,
      { id: (current.at(-1)?.id ?? 0) + 1, text, at: new Date().toISOString() },
    ]);
    setDraft('');
    requestAnimationFrame(() => list.current?.scrollToEnd('smooth'));
  };
  // A "remote" message every 6 s: when the viewer is scrolled up, "Nuovi messaggi ↓" appears instead of a jump.
  React.useEffect(() => {
    const timer = setInterval(() => {
      setLines((current) => [
        ...current,
        {
          id: (current.at(-1)?.id ?? 0) + 1,
          text: `Messaggio numero ${(current.at(-1)?.id ?? 0) + 1}`,
          at: new Date().toISOString(),
        },
      ]);
    }, 6000);
    return () => clearInterval(timer);
  }, []);
  return (
    <KeyboardAwareScreen
      aria-label={t('title')}
      header={
        <div className="border-border flex h-13 items-center justify-between border-b px-3">
          <h2 className="font-display text-base font-bold">{t('title')}</h2>
          <IconButton label={t('close')} onClick={onClose} data-testid="keyboard-demo-close">
            <X className="size-5" aria-hidden />
          </IconButton>
        </div>
      }
      footer={
        <div className="border-border flex items-end gap-2 border-t p-2">
          <Textarea
            aria-label={t('placeholder')}
            placeholder={t('placeholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            maxLength={500}
            counter
            autoGrow
            rows={1}
            wrapperClassName="flex-1"
            data-testid="keyboard-demo-composer"
          />
          <Button onClick={send} disabled={!draft.trim()} aria-label={t('send')}>
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
      }
    >
      <VirtualList
        ref={list}
        items={lines}
        getKey={(l) => String(l.id)}
        estimateSize={56}
        reverse
        hasMore={hasMore}
        loadingMore={loading}
        onLoadMore={loadEarlier}
        loader={<p className="bg-surface-2 text-muted py-1 text-center text-xs">{t('earlier')}</p>}
        onNewBelow={(n) => setNewBelow((c) => c + n)}
        onEndStateChange={(atEnd) => atEnd && setNewBelow(0)}
        role="log"
        aria-label={t('title')}
        renderItem={(l) => (
          <div className="px-3 py-1.5">
            <div className="bg-surface-2 border-border inline-block max-w-[85%] rounded-md border px-3 py-1.5 text-sm">
              <p>{l.text}</p>
              <TimeAgo at={l.at} className="text-subtle text-[11px]" />
            </div>
          </div>
        )}
      />
      {newBelow > 0 ? (
        <Button
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg"
          onClick={() => {
            list.current?.scrollToEnd('smooth');
            setNewBelow(0);
          }}
          data-testid="keyboard-demo-new-below"
        >
          <ArrowDown className="size-4" aria-hidden />
          {t('newBelow')}
        </Button>
      ) : null}
    </KeyboardAwareScreen>
  );
}
