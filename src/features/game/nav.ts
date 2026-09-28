import {
  BadgeEuro,
  BarChart3,
  Building2,
  Map as MapIcon,
  Menu,
  Package,
  Settings,
  Share2,
  ShoppingCart,
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

/**
 * Desktop sidebar: every section. No "Emergenze" entry (D-34): the incident list is the operations screen's own queue
 * column, with the full table one click away from its header (`/game/incidents` still works).
 */
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/game', labelKey: 'operations', icon: MapIcon },
  { href: '/game/facilities', labelKey: 'facilities', icon: Building2 },
  { href: '/game/fleet', labelKey: 'fleet', icon: Truck },
  { href: '/game/personnel', labelKey: 'personnel', icon: Users },
  { href: '/game/logistics', labelKey: 'logistics', icon: Package },
  { href: '/game/shop', labelKey: 'shop', icon: ShoppingCart, tutorialId: 'nav-shop' },
  { href: '/game/progression', labelKey: 'progression', icon: Trophy },
  { href: '/game/economy', labelKey: 'economy', icon: Wallet },
  {
    // Real money (03 §3 #3): its own name ("Ricarica Crediti") and a euro badge, never mistaken for "Acquisti" (the cart,
    // where vehicles and facilities are bought with the game's Credits).
    href: '/game/credits',
    labelKey: 'credits',
    icon: BadgeEuro,
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

/**
 * Mobile bottom navigation (D-34): Mappa · Flotta · Sedi · Acquisti · Altro — exactly five thumb-reachable items;
 * everything else lives under "More". The incident list lives in the map's bottom sheet (its waiting count is the
 * badge on "Mappa").
 */
export const BOTTOM_ITEMS: NavItem[] = [
  { href: '/game', labelKey: 'map', icon: MapIcon },
  { href: '/game/fleet', labelKey: 'fleet', icon: Truck },
  { href: '/game/facilities', labelKey: 'facilities', icon: Building2 },
  { href: '/game/shop', labelKey: 'shop', icon: ShoppingCart, tutorialId: 'nav-shop' },
  { href: '/game/more', labelKey: 'more', icon: Menu },
];

const BOTTOM_HREFS = new Set(BOTTOM_ITEMS.map((i) => i.href));
/** Everything that is not in the bottom bar, in sidebar order. */
export const MORE_ITEMS: NavItem[] = SIDEBAR_ITEMS.filter((i) => !BOTTOM_HREFS.has(i.href));

export const ADMIN_ICON = BarChart3;
export const isActive = (pathname: string, href: string): boolean =>
  href === '/game' ? pathname === '/game' : pathname === href || pathname.startsWith(`${href}/`);
