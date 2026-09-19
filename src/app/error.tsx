'use client';
import { ErrorView } from '@/components/error-view';

export default function RouteError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
