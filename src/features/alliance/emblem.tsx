'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import {
  AllianceEmblemColor,
  AllianceEmblemShape,
  AllianceEmblemSymbol,
  type AllianceConfigDto,
  type AllianceEmblemDto,
  type AllianceFrame,
} from '@/contracts';
import { cn } from '@/lib/utils';

/** Emblem colours (study 02 §1: templates only, never an uploaded image). Brand palette, no official liveries. */
export const EMBLEM_HEX: Record<AllianceEmblemColor, string> = {
  NAVY: '#1B2A4A',
  RED: '#C8232C',
  BLUE: '#2563EB',
  ORANGE: '#E0771A',
  GREEN: '#2E8B57',
  SILVER: '#C7CDD6',
  GOLD: '#D4A017',
  BLACK: '#15181F',
  WHITE: '#F4F6F9',
  PURPLE: '#6D3FB8',
  TEAL: '#1F8A8A',
  AMBER: '#F2B01E',
};

const SHAPE_PATH: Record<AllianceEmblemShape, string> = {
  SHIELD: 'M32 4 L56 12 V30 C56 46 44 56 32 60 C20 56 8 46 8 30 V12 Z',
  CIRCLE: 'M32 6 A26 26 0 1 1 31.9 6 Z',
  HEXAGON: 'M32 5 L55 18 V46 L32 59 L9 46 V18 Z',
  DIAMOND: 'M32 4 L58 32 L32 60 L6 32 Z',
  BANNER: 'M10 6 H54 V46 L32 60 L10 46 Z',
  STAR: 'M32 4 L39 24 L60 24 L43 36 L50 58 L32 45 L14 58 L21 36 L4 24 L25 24 Z',
  TRIANGLE: 'M32 6 L59 56 H5 Z',
  SQUARE: 'M10 10 H54 V54 H10 Z',
};

/** Simple line symbols drawn in the secondary colour, centred in a 64×64 box. */
function Symbol({ code, color }: { code: AllianceEmblemSymbol; color: string }) {
  const stroke = {
    stroke: color,
    strokeWidth: 3.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  switch (code) {
    case 'FLAME':
      return (
        <path
          d="M32 18 C38 26 40 30 38 36 C44 32 44 26 42 24 C46 34 44 46 32 48 C20 46 18 36 24 30 C24 34 26 36 28 36 C26 28 30 24 32 18 Z"
          fill={color}
        />
      );
    case 'CROSS_PLUS':
      return <path d="M27 20 H37 V27 H44 V37 H37 V44 H27 V37 H20 V27 H27 Z" fill={color} />;
    case 'WAVE':
      return (
        <path
          d="M16 30 C21 24 27 24 32 30 C37 36 43 36 48 30 M16 40 C21 34 27 34 32 40 C37 46 43 46 48 40"
          {...stroke}
        />
      );
    case 'MOUNTAIN':
      return <path d="M14 46 L26 24 L32 34 L38 28 L50 46 Z" fill={color} />;
    case 'HELMET':
      return <path d="M18 40 C18 28 24 20 32 20 C40 20 46 28 46 40 Z M14 40 H50 V44 H14 Z" fill={color} />;
    case 'STAR':
      return (
        <path d="M32 18 L36 28 L47 28 L38 35 L41 46 L32 39 L23 46 L26 35 L17 28 L28 28 Z" fill={color} />
      );
    case 'TREE':
      return <path d="M32 16 L42 32 H36 L46 46 H18 L28 32 H22 Z M30 46 H34 V52 H30 Z" fill={color} />;
    case 'BOLT':
      return <path d="M36 16 L22 36 H31 L28 50 L42 30 H33 Z" fill={color} />;
    case 'ANCHOR':
      return (
        <g {...stroke}>
          <circle cx="32" cy="19" r="4" />
          <path d="M32 23 V48 M20 30 H44 M18 40 C22 48 42 48 46 40" />
        </g>
      );
    case 'WING':
      return (
        <path
          d="M16 40 C22 26 34 20 50 22 C44 26 42 30 40 34 C36 34 34 36 30 40 C26 40 22 40 16 40 Z"
          fill={color}
        />
      );
    case 'SIREN':
      return (
        <path
          d="M22 42 C22 30 26 24 32 24 C38 24 42 30 42 42 Z M18 42 H46 V46 H18 Z M32 16 V20 M22 20 L24 23 M42 20 L40 23"
          {...stroke}
          fill={color}
        />
      );
    case 'COMPASS':
      return (
        <g>
          <circle cx="32" cy="32" r="14" {...stroke} />
          <path d="M32 20 L36 32 L32 44 L28 32 Z" fill={color} />
        </g>
      );
    case 'TOWER':
      return <path d="M24 48 V24 H28 V20 H36 V24 H40 V48 Z M30 30 H34 V36 H30 Z" fill={color} />;
    case 'EAGLE':
      return (
        <path d="M32 24 L44 18 L40 28 L50 32 L38 34 L32 46 L26 34 L14 32 L24 28 L20 18 Z" fill={color} />
      );
    case 'ROPE':
      return (
        <path d="M20 22 C28 18 36 26 44 22 M20 32 C28 28 36 36 44 32 M20 42 C28 38 36 46 44 42" {...stroke} />
      );
    case 'DROP':
      return (
        <path
          d="M32 16 C38 26 42 32 42 38 C42 44 37 48 32 48 C27 48 22 44 22 38 C22 32 26 26 32 16 Z"
          fill={color}
        />
      );
  }
}

const FRAME_HEX: Record<AllianceFrame, string> = { GOLD: '#D4A017', SILVER: '#C7CDD6', BRONZE: '#B3722F' };

export interface EmblemProps {
  emblem: AllianceEmblemDto;
  size?: number;
  /** Cosmetic frame of last week's top 3 (06 §3.3). */
  frame?: AllianceFrame | null;
  className?: string;
  title?: string;
}

/** The alliance crest: a shape in the primary colour, a symbol in the secondary one. Decorative unless `title` is given. */
export function Emblem({ emblem, size = 40, frame = null, className, title }: EmblemProps) {
  const primary = EMBLEM_HEX[emblem.primaryColor];
  const secondary = EMBLEM_HEX[emblem.secondaryColor];
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-testid="alliance-emblem"
      data-shape={emblem.shape}
      data-symbol={emblem.symbol}
    >
      {frame ? (
        <path d={SHAPE_PATH[emblem.shape]} fill="none" stroke={FRAME_HEX[frame]} strokeWidth="6" />
      ) : null}
      <path d={SHAPE_PATH[emblem.shape]} fill={primary} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      <Symbol code={emblem.symbol} color={secondary} />
    </svg>
  );
}

/** The guided composition (study 09 §2.1): one shape, one symbol, two colours; locked options show their level. */
export function EmblemPicker({
  value,
  onChange,
  options,
  level,
  disabled,
}: {
  value: AllianceEmblemDto;
  onChange: (next: AllianceEmblemDto) => void;
  options: AllianceConfigDto['emblem'];
  /** The alliance level deciding what is unlocked (1 when founding). */
  level: number;
  disabled?: boolean;
}) {
  const t = useTranslations('alliance.found');
  const minOf = (list: { code: string; minLevel: number }[], code: string) =>
    list.find((o) => o.code === code)?.minLevel ?? 1;
  const group = <C extends string>(
    label: string,
    codes: readonly C[],
    list: { code: string; minLevel: number }[],
    current: C,
    pick: (code: C) => void,
    render: (code: C) => React.ReactNode,
  ) => (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="text-muted mb-1.5 text-xs font-semibold tracking-wide uppercase">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {codes.map((code) => {
          const min = minOf(list, code);
          const locked = min > level;
          const selected = current === code;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={locked ? `${code} — ${t('lockedAt', { level: min })}` : code}
              title={locked ? t('lockedAt', { level: min }) : code}
              disabled={locked || disabled}
              onClick={() => pick(code)}
              data-testid={`emblem-${code}`}
              className={cn(
                'border-border-strong bg-surface-2 hover:bg-surface-3 relative grid size-10 place-items-center rounded-md border transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11',
                selected && 'border-focus ring-focus/50 ring-2',
                locked && 'opacity-45',
              )}
            >
              {render(code)}
              {locked ? (
                <Lock className="text-subtle absolute right-0.5 bottom-0.5 size-3" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div
        className="bg-surface-2 border-border grid shrink-0 place-items-center rounded-md border p-3"
        data-testid="emblem-preview"
      >
        <Emblem emblem={value} size={96} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {group(
          t('shape'),
          AllianceEmblemShape.options,
          options.shapes,
          value.shape,
          (shape) => onChange({ ...value, shape }),
          (shape) => (
            <Emblem emblem={{ ...value, shape, symbol: value.symbol }} size={28} />
          ),
        )}
        {group(
          t('symbol'),
          AllianceEmblemSymbol.options,
          options.symbols,
          value.symbol,
          (symbol) => onChange({ ...value, symbol }),
          (symbol) => (
            <svg viewBox="0 0 64 64" width={28} height={28} aria-hidden>
              <Symbol code={symbol} color="var(--rc-text)" />
            </svg>
          ),
        )}
        {group(
          t('primary'),
          AllianceEmblemColor.options,
          options.colors,
          value.primaryColor,
          (primaryColor) => onChange({ ...value, primaryColor }),
          (color) => (
            <span
              className="size-6 rounded-full border border-white/20"
              style={{ background: EMBLEM_HEX[color] }}
              aria-hidden
            />
          ),
        )}
        {group(
          t('secondary'),
          AllianceEmblemColor.options,
          options.colors,
          value.secondaryColor,
          (secondaryColor) => onChange({ ...value, secondaryColor }),
          (color) => (
            <span
              className="size-6 rounded-full border border-white/20"
              style={{ background: EMBLEM_HEX[color] }}
              aria-hidden
            />
          ),
        )}
      </div>
    </div>
  );
}

export const DEFAULT_EMBLEM: AllianceEmblemDto = {
  shape: 'SHIELD',
  symbol: 'FLAME',
  primaryColor: 'RED',
  secondaryColor: 'SILVER',
};
