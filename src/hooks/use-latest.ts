'use client';
import * as React from 'react';

/** Ref that always holds the latest value, updated after commit (safe with the React Compiler: never written during render). */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  React.useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
