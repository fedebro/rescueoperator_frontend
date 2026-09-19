import type { Metadata } from 'next';
import { AdminLayout } from '@/features/admin/admin-layout';

export const metadata: Metadata = { title: 'Admin' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}
