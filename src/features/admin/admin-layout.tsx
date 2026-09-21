'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Briefcase,
  ChevronRight,
  CreditCard,
  Flag,
  Gauge,
  Globe2,
  History,
  ListChecks,
  Map as MapIcon,
  Menu,
  Search,
  Settings2,
  ShieldAlert,
  ShieldX,
  Siren,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { adminApi } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useAuthStore, isAdminUser } from '@/stores/auth';
import { useIsDesktop } from '@/hooks/use-media-query';
import { BrandSplash } from '@/components/brand/splash';
import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { SectionHelpButton, SectionPrimer } from '@/features/coaching/section-primer';
import { resolveEnvironment, type AdminEnvironment } from './environment';

const ITEMS = [
  { href: '/admin', key: 'dashboard', icon: Gauge },
  { href: '/admin/users', key: 'users', icon: Users },
  { href: '/admin/careers', key: 'careers', icon: Briefcase },
  { href: '/admin/incidents', key: 'incidents', icon: Siren },
  { href: '/admin/scheduled-actions', key: 'scheduledActions', icon: ListChecks },
  { href: '/admin/config', key: 'config', icon: Settings2 },
  { href: '/admin/catalog', key: 'catalog', icon: BookOpen },
  { href: '/admin/flags', key: 'flags', icon: Flag },
  { href: '/admin/world', key: 'world', icon: MapIcon },
  { href: '/admin/geodata', key: 'geodata', icon: Globe2 },
  { href: '/admin/referrals', key: 'referrals', icon: UserPlus },
  { href: '/admin/purchases', key: 'purchases', icon: CreditCard },
  { href: '/admin/audit', key: 'audit', icon: History },
] as const satisfies readonly { href: string; key: string; icon: LucideIcon }[];

const isActive = (href: string, pathname: string) =>
  href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);

/** Where a pasted public id leads (usr_/car_/inc_), or null when the prefix is not inspectable. */
export function searchTarget(raw: string): string | null {
  const value = raw.trim();
  if (!/^[a-z]{3}_[0-9A-Za-z]+$/.test(value)) return null;
  if (value.startsWith('usr_')) return `/admin/users/${value}`;
  if (value.startsWith('car_')) return `/admin/careers/${value}`;
  if (value.startsWith('inc_')) return `/admin/incidents/${value}`;
  return null;
}

/**
 * Shell of /admin: role guard (the API enforces roles again on every call — this gate is UX), persistent environment
 * banner, navigation (sidebar on desktop, drawer on phones), breadcrumb, search by id, link back to the game.
 */
export function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  React.useEffect(() => {
    if (status === 'anonymous') router.replace('/auth');
  }, [status, router]);
  if (status !== 'authenticated') return <BrandSplash />;
  if (!isAdminUser(user)) return <Forbidden />;
  return <Shell>{children}</Shell>;
}

function Forbidden() {
  const t = useTranslations('admin.shell');
  return (
    <main className="h-dvh-safe bg-bg grid place-items-center p-6" data-testid="admin-forbidden">
      <EmptyState
        icon={<ShieldX className="size-6" />}
        title={t('forbiddenTitle')}
        description={t('forbiddenBody')}
        action={
          <Button asChild variant="secondary">
            <Link href="/game">
              <ArrowLeft className="size-4" aria-hidden />
              {t('backToGame')}
            </Link>
          </Button>
        }
      />
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin.nav');
  const ts = useTranslations('admin.shell');
  const tc = useTranslations('common');
  const ta = useTranslations('coaching.sections.admin');
  const tco = useTranslations('coaching');
  const pathname = usePathname();
  const desktop = useIsDesktop();
  const user = useAuthStore((s) => s.user);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const adminContent = {
    sectionKey: 'admin',
    title: ta('title'),
    body: ta('body'),
    tips: [ta('tip1'), ta('tip2')],
  };

  const nav = (
    <nav aria-label={t('label')}>
      <ul className="flex flex-col gap-0.5 px-2 py-2">
        {ITEMS.map((item) => {
          const active = isActive(item.href, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'text-muted hover:bg-surface-3 hover:text-fg flex h-10 items-center gap-2.5 rounded-md px-3 text-sm font-semibold lg:h-9',
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
  );
  const account = (
    <div className="text-subtle border-border border-t px-4 py-3 text-xs">
      <p className="truncate">{user?.email}</p>
      <p className="mt-1 flex flex-wrap gap-1">
        {user?.roles
          .filter((r) => r !== 'USER')
          .map((r) => (
            <Badge key={r} tone="brand">
              {ts(`roles.${r}`)}
            </Badge>
          ))}
      </p>
      <Link href="/game" className="text-skyline mt-3 inline-flex items-center gap-1 hover:underline">
        <ArrowLeft className="size-3" aria-hidden />
        {ts('backToGame')}
      </Link>
    </div>
  );

  return (
    <div className="h-dvh-safe bg-bg flex flex-col">
      <EnvironmentBanner />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {desktop ? (
          <aside className="border-border bg-surface-1 flex w-60 shrink-0 flex-col border-r">
            <div className="flex items-center gap-2 px-4 py-3">
              <Logo variant="horizontal" className="w-28" />
              <Badge tone="brand">
                <Activity className="size-3" aria-hidden />
                {t('badge')}
              </Badge>
            </div>
            <div className="scroll-y min-h-0 flex-1">{nav}</div>
            {account}
          </aside>
        ) : (
          <header className="border-border bg-surface-1 flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <IconButton label={ts('openMenu')} variant="ghost" onClick={() => setMenuOpen(true)}>
              <Menu className="size-5" aria-hidden />
            </IconButton>
            <Logo variant="horizontal" className="w-24" />
            <Badge tone="brand">{t('badge')}</Badge>
            <Drawer
              open={menuOpen}
              onOpenChange={setMenuOpen}
              side="left"
              title={ts('menuTitle')}
              closeLabel={tc('close')}
            >
              {nav}
              {account}
            </Drawer>
          </header>
        )}
        <main className="scroll-y min-h-0 min-w-0 flex-1">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 lg:p-6">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <Breadcrumb pathname={pathname} />
              <div className="flex items-center gap-2">
                <GlobalSearch />
                <SectionHelpButton
                  content={adminContent}
                  label={tco('help.buttonLabel')}
                  closeLabel={tc('close')}
                />
              </div>
            </div>
            <SectionPrimer content={adminContent} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

const ENV_STYLE: Record<AdminEnvironment, string> = {
  LOCAL: 'bg-info/15 text-info border-info/40',
  MOCK: 'bg-xp/15 text-xp border-xp/40',
  STAGING: 'bg-warning/15 text-warning border-warning/40',
  PRODUCTION: 'bg-danger text-white border-danger',
};

/** Always on screen and never dismissible: acting on the wrong environment is the costliest admin mistake. */
function EnvironmentBanner() {
  const t = useTranslations('admin.shell');
  const version = useQuery({ queryKey: qk.admin('version'), queryFn: adminApi.version, staleTime: 300_000 });
  const environment = resolveEnvironment(version.data?.environment);
  const production = environment === 'PRODUCTION';
  return (
    <div
      role="status"
      data-testid="admin-env-banner"
      data-environment={environment}
      className={cn(
        'pt-safe flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 border-b px-3 py-1 text-xs font-bold tracking-wide',
        ENV_STYLE[environment],
      )}
    >
      <span className="inline-flex items-center gap-1.5 uppercase">
        <ShieldAlert className="size-3.5" aria-hidden />
        {t('environment', { name: t(`env.${environment}`) })}
      </span>
      {production ? <span className="font-semibold">{t('productionWarning')}</span> : null}
      {version.data?.version ? (
        <span className="font-mono font-normal opacity-80">
          {t('version', {
            version: version.data.version,
            config: version.data.configVersion ?? '—',
            catalog: version.data.catalogVersion ?? '—',
          })}
        </span>
      ) : null}
    </div>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const t = useTranslations('admin.nav');
  const ts = useTranslations('admin.shell');
  const section = ITEMS.find((i) => i.href !== '/admin' && isActive(i.href, pathname));
  const leaf = section ? pathname.slice(section.href.length + 1) : '';
  const crumbs: { label: string; href?: string }[] = [
    { label: t('badge'), href: section ? '/admin' : undefined },
    ...(section
      ? [{ label: t(section.key), href: leaf ? section.href : undefined }]
      : [{ label: t('dashboard') }]),
    ...(leaf ? [{ label: decodeURIComponent(leaf) }] : []),
  ];
  return (
    <nav aria-label={ts('breadcrumb')} className="min-w-0">
      <ol className="text-subtle flex flex-wrap items-center gap-1 text-xs">
        {crumbs.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3 shrink-0" aria-hidden /> : null}
            {c.href ? (
              <Link href={c.href} className="hover:text-fg hover:underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-muted truncate font-semibold">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function GlobalSearch() {
  const t = useTranslations('admin.shell');
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [invalid, setInvalid] = React.useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = searchTarget(value);
    setInvalid(!target);
    if (!target) return;
    setValue('');
    router.push(target);
  };
  return (
    <form onSubmit={submit} role="search" className="flex w-full flex-col gap-1 lg:w-80">
      <Input
        type="search"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchLabel')}
        aria-describedby={invalid ? 'admin-search-error' : undefined}
        invalid={invalid}
        leading={<Search className="size-4" />}
        className="h-10 text-base lg:h-9 lg:text-sm"
        autoComplete="off"
        spellCheck={false}
      />
      {invalid ? (
        <p id="admin-search-error" role="alert" className="text-danger text-xs">
          {t('searchInvalid')}
        </p>
      ) : null}
    </form>
  );
}
