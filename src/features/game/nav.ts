import {
  BarChart3,
  Building2,
  Map as MapIcon,
  Menu,
  Settings,
  ShoppingCart,
  Siren,
  Trophy,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  tutorialId?: string;
}

/** Desktop sidebar: every section. */
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/game', labelKey: 'operations', icon: MapIcon },
  { href: '/game/incidents', labelKey: 'incidents', icon: Siren },
  { href: '/game/facilities', labelKey: 'facilities', icon: Building2 },
  { href: '/game/fleet', labelKey: 'fleet', icon: Truck },
  { href: '/game/shop', labelKey: 'shop', icon: ShoppingCart, tutorialId: 'nav-shop' },
  { href: '/game/progression', labelKey: 'progression', icon: Trophy },
  { href: '/game/economy', labelKey: 'economy', icon: Wallet },
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

export const MORE_ITEMS: NavItem[] = [
  { href: '/game/facilities', labelKey: 'facilities', icon: Building2 },
  { href: '/game/progression', labelKey: 'progression', icon: Trophy },
  { href: '/game/economy', labelKey: 'economy', icon: Wallet },
  { href: '/game/settings', labelKey: 'settings', icon: Settings },
];

export const ADMIN_ICON = BarChart3;
export const isActive = (pathname: string, href: string): boolean =>
  href === '/game' ? pathname === '/game' : pathname === href || pathname.startsWith(`${href}/`);
