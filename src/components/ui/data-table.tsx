'use client';
import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  id: string;
  header: string;
  /** CSS grid track, e.g. "minmax(140px,2fr)" or "96px" */
  width?: string;
  align?: 'left' | 'right' | 'center';
  cell: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | bigint;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  density?: 'dense' | 'compact';
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: React.ReactNode;
  caption: string;
  maxHeight?: number | string;
  className?: string;
}

/** Virtualized grid-based table (ARIA table roles) — keeps 10k rows smooth; dense = 32px rows, compact = 40px. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  density = 'dense',
  onRowClick,
  selectedKey,
  empty,
  caption,
  maxHeight = 480,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<{ id: string; dir: 1 | -1 } | null>(null);
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowHeight = density === 'dense' ? 32 : 40;
  const template = columns.map((c) => c.width ?? 'minmax(96px,1fr)').join(' ');

  const sorted = React.useMemo(() => {
    const col = sort ? columns.find((c) => c.id === sort.id) : undefined;
    if (!sort || !col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = get(a),
        y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is safe here: the component is not memoised by the compiler
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    initialRect: { width: 800, height: 480 },
  });
  const items = virtualizer.getVirtualItems();

  return (
    <div
      role="table"
      aria-label={caption}
      aria-rowcount={sorted.length + 1}
      className={cn('panel flex min-w-0 flex-col overflow-hidden text-[13px]', className)}
    >
      <div className="overflow-x-auto">
        <div className="min-w-max">
          <div
            role="row"
            className="border-border bg-surface-2 text-subtle grid h-9 items-center border-b text-[11px] font-semibold tracking-wide uppercase"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((c) => {
              const active = sort?.id === c.id;
              return (
                <div
                  key={c.id}
                  role="columnheader"
                  aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'px-3',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className="hover:text-fg inline-flex items-center gap-1 uppercase"
                      onClick={() =>
                        setSort((s) =>
                          s?.id === c.id
                            ? s.dir === 1
                              ? { id: c.id, dir: -1 }
                              : null
                            : { id: c.id, dir: 1 },
                        )
                      }
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === 1 ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    c.header
                  )}
                </div>
              );
            })}
          </div>
          <div ref={parentRef} role="rowgroup" className="scroll-y" style={{ maxHeight }}>
            {sorted.length === 0 ? (
              <div className="p-6">{empty}</div>
            ) : (
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {items.map((vi) => {
                  const row = sorted[vi.index]!;
                  const key = rowKey(row);
                  const clickable = !!onRowClick;
                  return (
                    <div
                      key={key}
                      role="row"
                      aria-rowindex={vi.index + 2}
                      aria-selected={selectedKey === key || undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onRowClick(row);
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        'border-border/60 absolute inset-x-0 grid items-center border-b',
                        clickable && 'hover:bg-surface-2 cursor-pointer',
                        selectedKey === key && 'bg-surface-3',
                      )}
                      style={{
                        gridTemplateColumns: template,
                        height: rowHeight,
                        transform: `translateY(${vi.start}px)`,
                      }}
                    >
                      {columns.map((c) => (
                        <div
                          key={c.id}
                          role="cell"
                          className={cn(
                            'min-w-0 truncate px-3',
                            c.align === 'right' && 'tabular text-right',
                            c.align === 'center' && 'text-center',
                          )}
                        >
                          {c.cell(row)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
