import {
  BarChart3,
  Building2,
  Coins,
  Map as MapIcon,
  Menu,
  Package,
  Settings,
  Share2,
  ShoppingCart,
  Siren,
  Trophy,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  tutorialId?: string;
  /** Shown only once monetization is unlocked (tutorial + first organic purchase) and the feature flag is on. */
  gate?: { monetization: true; flag: 'creditShop' | 'referrals' };
}

/** Desktop sidebar: every section. */
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/game', labelKey: 'operations', icon: MapIcon },
  { href: '/game/incidents', labelKey: 'incidents', icon: Siren },
  { href: '/game/facilities', labelKey: 'facilities', icon: Building2 },
  { href: '/game/fleet', labelKey: 'fleet', icon: Truck },
  { href: '/game/personnel', labelKey: 'personnel', icon: Users },
  { href: '/game/logistics', labelKey: 'logistics', icon: Package },
  { href: '/game/shop', labelKey: 'shop', icon: ShoppingCart, tutorialId: 'nav-shop' },
  { href: '/game/progression', labelKey: 'progression', icon: Trophy },
  { href: '/game/economy', labelKey: 'economy', icon: Wallet },
  {
    href: '/game/credits',
    labelKey: 'credits',
    icon: Coins,
    gate: { monetization: true, flag: 'creditShop' },
  },
  {
    href: '/game/network',
    labelKey: 'network',
    icon: Share2,
    gate: { monetization: true, flag: 'referrals' },
  },
  { href: '/game/settings', labelKey: 'settings', icon: Settings },
];

/** Mobile bottom navigation: exactly five thumb-reachable items; everything else lives under "More". */
export const BOTTOM_ITEMS: NavItem[] = [
  { href: '/game', labelKey: 'map', icon: MapIcon },
  { href: '/game/incidents', labelKey: 'incidents', icon: Siren },
  { href: '/game/fleet', labelKey: 'fleet', icon: Truck },
  { href: '/game/shop', labelKey: 'shop', icon: ShoppingCart, tutorialId: 'nav-shop' },
  { href: '/game/more', labelKey: 'more', icon: Menu },
];

const BOTTOM_HREFS = new Set(BOTTOM_ITEMS.map((i) => i.href));
/** Everything that is not in the bottom bar, in sidebar order. */
export const MORE_ITEMS: NavItem[] = SIDEBAR_ITEMS.filter((i) => !BOTTOM_HREFS.has(i.href));

export const ADMIN_ICON = BarChart3;
export const isActive = (pathname: string, href: string): boolean =>
  href === '/game' ? pathname === '/game' : pathname === href || pathname.startsWith(`${href}/`);
