import type { Metadata } from 'next';
import { DesignScreen } from '@/features/design/design-screen';

export const metadata: Metadata = { title: 'Design system' };

export default function Page() {
  return <DesignScreen />;
}
