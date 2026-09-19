'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Activity,
  ArrowLeft,
  Flag,
  Gauge,
  ListChecks,
  Scale,
  Settings2,
  Siren,
  Users,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import { useSessionGate } from '@/hooks/use-session';
import { useAuthStore } from '@/stores/auth';
import { BrandSplash } from '@/components/brand/splash';
import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ITEMS: { href: string; key: string; icon: LucideIcon }[] = [
  { href: '/admin', key: 'dashboard', icon: Gauge },
  { href: '/admin/users', key: 'users', icon: Users },
  { href: '/admin/careers', key: 'careers', icon: Briefcase },
  { href: '/admin/incidents', key: 'incidents', icon: Siren },
  { href: '/admin/scheduled-actions', key: 'scheduledActions', icon: ListChecks },
  { href: '/admin/ledger', key: 'ledger', icon: Scale },
  { href: '/admin/config', key: 'config', icon: Settings2 },
  { href: '/admin/flags', key: 'flags', icon: Flag },
];

/** Role-gated shell for /admin. The API enforces the role again on every call; this gate is only UX. */
export function AdminLayout({ children }: { children: React.ReactNode }) {
  const allowed = useSessionGate('admin');
  const t = useTranslations('admin.nav');
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  if (!allowed) return <BrandSplash />;
  return (
    <div className="h-dvh-safe bg-bg flex flex-col lg:flex-row">
      <aside className="pt-safe border-border bg-surface-1 shrink-0 border-b lg:w-60 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3">
          <Logo variant="horizontal" className="w-28" />
          <Badge tone="brand">
            <Activity className="size-3" aria-hidden />
            {t('badge')}
          </Badge>
        </div>
        <nav aria-label={t('label')}>
          <ul className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
            {ITEMS.map((item) => {
              const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'text-muted hover:bg-surface-3 hover:text-fg flex h-10 items-center gap-2.5 rounded-md px-3 text-sm font-semibold',
                      active && 'bg-surface-3 text-fg',
                    )}
                  >
                    <item.icon className="size-4" aria-hidden />
                    {t(item.key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="text-subtle hidden px-4 py-3 text-xs lg:block">
          <p className="truncate">{user?.email}</p>
          <p>{user?.roles.filter((r) => r !== 'USER').join(', ')}</p>
          <Link href="/game" className="text-skyline mt-3 inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" aria-hidden />
            {t('backToGame')}
          </Link>
        </div>
      </aside>
      <main className="scroll-y min-h-0 min-w-0 flex-1">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">{children}</div>
      </main>
    </div>
  );
}
