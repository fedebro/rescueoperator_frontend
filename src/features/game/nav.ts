import {
  BadgeEuro,
  BarChart3,
  Building2,
  Handshake,
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

/**
 * When an entry is shown. Every condition set must hold: `monetization` = unlocked (tutorial + first organic purchase),
 * `flag` = that server feature flag of the snapshot is `true`, `minLevel` = the career has reached that level.
 */
export interface NavGate {
  monetization?: true;
  flag?: string;
  minLevel?: number;
}

/** The live counters of the snapshot an entry can carry as a badge (resolved by `useNavBadges`). */
export type NavBadge = 'pendingIncidents' | 'alliance';

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  tutorialId?: string;
  gate?: NavGate;
  /** Which counter this entry shows; "Altro" on the phone shows the sum of its entries' badges. */
  badge?: NavBadge;
}

/**
 * Desktop sidebar: every section. No "Emergenze" entry (D-34): the incident list is the operations screen's own queue
 * column, with the full table one click away from its header (`/game/incidents` still works).
 */
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/game', labelKey: 'operations', icon: MapIcon },
  // The alliance (D-123): after the operations centre, with the unread counter of the chat and the board.
  {
    href: '/game/alliance',
    labelKey: 'alliance',
    icon: Handshake,
    gate: { flag: 'alliances' },
    badge: 'alliance',
  },
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
 * badge on "Mappa"); "Altro" carries the sum of the badges of the entries it hides (the alliance's unread, D-123).
 */
export const BOTTOM_ITEMS: NavItem[] = [
  { href: '/game', labelKey: 'map', icon: MapIcon, badge: 'pendingIncidents' },
  { href: '/game/fleet', labelKey: 'fleet', icon: Truck },
  { href: '/game/facilities', labelKey: 'facilities', icon: Building2 },
  { href: '/game/shop', labelKey: 'shop', icon: ShoppingCart, tutorialId: 'nav-shop' },
  { href: '/game/more', labelKey: 'more', icon: Menu },
];

const BOTTOM_HREFS = new Set(BOTTOM_ITEMS.map((i) => i.href));
/** Everything that is not in the bottom bar, in sidebar order (the alliance first). */
export const MORE_ITEMS: NavItem[] = SIDEBAR_ITEMS.filter((i) => !BOTTOM_HREFS.has(i.href));

export const ADMIN_ICON = BarChart3;
export const isActive = (pathname: string, href: string): boolean =>
  href === '/game' ? pathname === '/game' : pathname === href || pathname.startsWith(`${href}/`);

/** Pure form of the gate check (the hook `useVisibleNav` feeds it the snapshot). */
export function navAllowed(
  gate: NavGate | undefined,
  ctx: { monetizationUnlocked: boolean; featureFlags: Record<string, boolean>; level: number },
): boolean {
  if (!gate) return true;
  if (gate.monetization && !ctx.monetizationUnlocked) return false;
  if (gate.flag && ctx.featureFlags[gate.flag] !== true) return false;
  if (gate.minLevel !== undefined && ctx.level < gate.minLevel) return false;
  return true;
}
