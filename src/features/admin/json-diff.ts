export interface DiffEntry {
  /** Dotted key path, e.g. `economy.rewardMultiplier`. */
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Key-path diff of two JSON documents. Objects are walked recursively; arrays and scalars are leaves (an array that
 * differs is reported as one change: positional diffs of balancing tables read worse than old → new).
 */
export function diffJson(before: unknown, after: unknown, path = ''): DiffEntry[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => {
      const next = path ? `${path}.${key}` : key;
      if (!(key in before)) return [{ path: next, kind: 'added' as const, after: after[key] }];
      if (!(key in after)) return [{ path: next, kind: 'removed' as const, before: before[key] }];
      return diffJson(before[key], after[key], next);
    });
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: path || '$', kind: 'changed', before, after }];
}

export type JsonCheck =
  { ok: true; value: Record<string, unknown> } | { ok: false; message: string; line: number | null };

/**
 * Offset of the first syntax error, or null when the text is valid JSON. Engines disagree on whether `JSON.parse`
 * reports a position (V8 stopped doing so for most errors), so the editor finds it with its own strict scanner.
 */
export function jsonErrorOffset(source: string): number | null {
  let i = 0;
  const fail = (): never => {
    throw i;
  };
  const ws = () => {
    while (i < source.length && ' \t\n\r'.includes(source[i]!)) i++;
  };
  const literal = (word: string) => {
    if (source.startsWith(word, i)) i += word.length;
    else fail();
  };
  const string = () => {
    i++; // opening quote
    for (; i < source.length; i++) {
      const ch = source[i]!;
      if (ch === '"') return void i++;
      if (ch === '\n') fail();
      if (ch === '\\') i++;
    }
    fail();
  };
  const value = (): void => {
    ws();
    const ch = source[i];
    if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      i++;
      ws();
      if (source[i] === close) return void i++;
      for (;;) {
        if (close === '}') {
          ws();
          if (source[i] !== '"') fail();
          string();
          ws();
          if (source[i] !== ':') fail();
          i++;
        }
        value();
        ws();
        if (source[i] === ',') i++;
        else if (source[i] === close) return void i++;
        else fail();
      }
    }
    if (ch === '"') return string();
    if (ch === 't') return literal('true');
    if (ch === 'f') return literal('false');
    if (ch === 'n') return literal('null');
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(source.slice(i));
    if (!number) fail();
    else i += number[0].length;
  };
  try {
    value();
    ws();
    if (i < source.length) fail();
    return null;
  } catch (offset) {
    if (typeof offset === 'number') return Math.min(offset, source.length);
    throw offset;
  }
}

/** Parses the editor text; a syntax error comes with its 1-based line so the gutter can point at it. */
export function parseJsonDocument(source: string): JsonCheck {
  try {
    const value: unknown = JSON.parse(source);
    if (!isObject(value)) return { ok: false, message: 'Root must be an object', line: 1 };
    return { ok: true, value };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid JSON';
    const offset = jsonErrorOffset(source);
    return { ok: false, message, line: offset === null ? null : source.slice(0, offset).split('\n').length };
  }
}
