import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { z } from 'zod';
import type { AdsStatusDto, CreditPackageDto, ReferralDto } from '@/contracts';
import { CatalogTextsOverride } from '@/i18n/catalog-texts';
import { renderWithIntl } from '@/test/render';
import { snapshot } from '@/test/fixtures';

const state = vi.hoisted(() => ({
  snapshot: null as unknown,
  adsStatus: null as unknown,
  adStart: vi.fn(),
  adComplete: vi.fn(),
  speedupQuote: vi.fn(),
  speedup: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/game/hooks', () => ({
  useSnapshot: () => state.snapshot,
  useCareerId: () => 'car_TEST',
  usePatchSnapshot: () => vi.fn(),
}));
vi.mock('@/lib/api/depth', () => ({
  monetizationApi: {
    adsStatus: () => Promise.resolve(state.adsStatus),
    adStart: state.adStart,
    adComplete: state.adComplete,
    speedupQuote: state.speedupQuote,
    speedup: state.speedup,
  },
}));

import { InsufficientCreditsHost, requestCredits, useInsufficientCredits } from './insufficient-credits';
import { PackageCard } from './credits-screen';
import { PurchaseStatusChip } from './purchase-status';
import { InvitedList, MyInvitationCard, NetworkProgressCard } from './referral-screen';
import { SpeedupButton } from './speedup-button';
import { useWatchProgress } from './ads/simulated-player';

type AdsStatus = z.infer<typeof AdsStatusDto>;
type Package = z.infer<typeof CreditPackageDto>;
type Referral = z.infer<typeof ReferralDto>;

const future = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const ads = (patch: Partial<AdsStatus> = {}): AdsStatus => ({
  enabled: true,
  provider: 'simulated',
  reward: '80',
  dailyLimit: 5,
  watchedToday: 1,
  nextAvailableAt: null,
  resetsAt: future(3600),
  ...patch,
});
const world = (o: { unlocked: boolean; flags?: Record<string, boolean>; credits?: string }) => {
  const base = snapshot();
  const first = base.vehicles[0]!;
  return {
    ...base,
    career: {
      ...base.career,
      credits: o.credits ?? '100',
      tutorial: { ...base.career.tutorial, completed: true },
    },
    vehicles: o.unlocked ? [first, { ...first, id: 'veh_2' }] : [first],
    featureFlags: { rewardedAds: true, creditShop: true, referrals: true, ...o.flags },
  };
};
const ui = (node: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <CatalogTextsOverride
        value={{
          'speedupKind.TRAINING.name': 'Formazione',
          'creditPackage.PACK_M.name': 'Pacchetto Squadra',
        }}
      >
        {node}
      </CatalogTextsOverride>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  state.adsStatus = ads();
  state.adStart.mockReset();
  state.adComplete.mockReset();
  state.speedupQuote.mockReset();
  state.speedup.mockReset();
});
afterEach(() => act(() => useInsufficientCredits.getState().close()));

describe('InsufficientCreditsHost', () => {
  it('before the gate opens only "keep playing" exists — the paid options are not teased', () => {
    state.snapshot = world({ unlocked: false });
    ui(<InsufficientCreditsHost />);
    act(() => requestCredits('900'));
    const dialog = screen.getByTestId('insufficient-credits');
    const items = within(dialog).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Continua a giocare');
    expect(dialog).toHaveTextContent('800'); // missing = price − balance
  });

  it('with the gate open lists the three options in the mandated order, with N/M on the video', async () => {
    state.snapshot = world({ unlocked: true });
    ui(<InsufficientCreditsHost />);
    act(() => requestCredits('900'));
    const items = within(screen.getByTestId('insufficient-credits')).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Continua a giocare'),
      expect.stringContaining('Guarda un video'),
      expect.stringContaining('Acquista Crediti'),
    ]);
    await waitFor(() => expect(items[1]).toHaveTextContent('1/5 oggi'));
    expect(within(items[2]!).getByRole('link')).toHaveAttribute('href', '/game/credits');
  });

  it('disables the video with its reason when the daily limit is reached or the flag is off', async () => {
    state.snapshot = world({ unlocked: true });
    state.adsStatus = ads({ watchedToday: 5 });
    const view = ui(<InsufficientCreditsHost />);
    act(() => requestCredits('900'));
    await waitFor(() => expect(screen.getByTestId('ad-blocked')).toHaveAttribute('data-reason', 'LIMIT'));
    expect(screen.getByTestId('insufficient-watch-ad')).toBeDisabled();
    view.unmount();

    state.snapshot = world({ unlocked: true, flags: { rewardedAds: false, creditShop: false } });
    ui(<InsufficientCreditsHost />);
    act(() => requestCredits('900'));
    const items = within(screen.getByTestId('insufficient-credits')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[1]!).getByRole('button')).toBeDisabled();
    expect(items[1]).toHaveTextContent('Non disponibile');
    expect(within(items[2]!).getByRole('button')).toBeDisabled();
  });

  it('runs the simulated player inline: cannot finish early, abandoning gives nothing, the end credits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.snapshot = world({ unlocked: true });
      state.adStart.mockResolvedValue({
        adToken: 'tok1',
        minWatchSeconds: 3,
        provider: 'simulated',
        providerConfig: {},
      });
      state.adComplete.mockResolvedValue({
        credited: '80',
        status: ads({ watchedToday: 2, nextAvailableAt: future(600) }),
      });
      ui(<InsufficientCreditsHost />);
      act(() => requestCredits('900'));
      await waitFor(() => expect(screen.getByTestId('insufficient-watch-ad')).toBeEnabled());

      fireEvent.click(screen.getByTestId('insufficient-watch-ad'));
      const player = await screen.findByTestId('ad-player');
      expect(player).toHaveTextContent('Simulazione');
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(state.adComplete).not.toHaveBeenCalled();
      fireEvent.click(within(player).getByRole('button', { name: 'Interrompi il video' }));
      await waitFor(() => expect(screen.queryByTestId('ad-player')).toBeNull());
      expect(state.adComplete).not.toHaveBeenCalled();

      await waitFor(() => expect(screen.getByTestId('insufficient-watch-ad')).toBeEnabled());
      fireEvent.click(screen.getByTestId('insufficient-watch-ad'));
      await screen.findByTestId('ad-player');
      await act(() => vi.advanceTimersByTimeAsync(3500));
      await waitFor(() => expect(state.adComplete).toHaveBeenCalledTimes(1));
      expect(state.adComplete.mock.calls[0]![1]).toMatchObject({ adToken: 'tok1' });
      await waitFor(() =>
        expect(screen.getByTestId('ad-blocked')).toHaveAttribute('data-reason', 'COOLDOWN'),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SpeedupButton', () => {
  it('hides itself when there is no running timer', () => {
    state.snapshot = world({ unlocked: true });
    const { container } = ui(<SpeedupButton target="TRAINING" targetId="enr_1" endsAt={null} />);
    expect(container).toBeEmptyDOMElement();
    const past = ui(
      <SpeedupButton target="TRAINING" targetId="enr_1" endsAt={new Date(Date.now() - 1000).toISOString()} />,
    );
    expect(past.container).toBeEmptyDOMElement();
  });

  it('shows the quote before spending and confirms', async () => {
    state.snapshot = world({ unlocked: true, credits: '500' });
    state.speedupQuote.mockResolvedValue({
      target: 'TRAINING',
      targetId: 'enr_1',
      remainingSeconds: 125,
      cost: '42',
    });
    state.speedup.mockResolvedValue({ target: 'TRAINING', targetId: 'enr_1', cost: '42' });
    const onDone = vi.fn();
    ui(<SpeedupButton target="TRAINING" targetId="enr_1" endsAt={future(125)} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Termina ora' }));
    const dialog = await screen.findByTestId('speedup-dialog');
    expect(dialog).toHaveTextContent('Formazione');
    await waitFor(() => expect(within(dialog).getByTestId('speedup-cost')).toHaveTextContent('42'));
    expect(dialog).toHaveTextContent('2:05');
    expect(state.speedup).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('speedup-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(state.speedup).toHaveBeenCalledWith('car_TEST', 'TRAINING', 'enr_1');
  });

  it('opens the "not enough credits" flow instead of spending when the balance is short', async () => {
    state.snapshot = world({ unlocked: true, credits: '10' });
    state.speedupQuote.mockResolvedValue({
      target: 'TRAINING',
      targetId: 'enr_1',
      remainingSeconds: 125,
      cost: '42',
    });
    ui(<SpeedupButton target="TRAINING" targetId="enr_1" endsAt={future(125)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Termina ora' }));
    const dialog = await screen.findByTestId('speedup-dialog');
    await waitFor(() => expect(within(dialog).getByTestId('speedup-cost')).toHaveTextContent('42'));
    fireEvent.click(within(dialog).getByTestId('speedup-confirm'));
    expect(state.speedup).not.toHaveBeenCalled();
    expect(useInsufficientCredits.getState().price).toBe('42');
  });

  it('labels a free finish', async () => {
    state.snapshot = world({ unlocked: true });
    state.speedupQuote.mockResolvedValue({
      target: 'TRAINING',
      targetId: 'enr_1',
      remainingSeconds: 12,
      cost: '0',
    });
    ui(<SpeedupButton target="TRAINING" targetId="enr_1" endsAt={future(12)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Termina ora' }));
    const dialog = await screen.findByTestId('speedup-dialog');
    await waitFor(() => expect(within(dialog).getByTestId('speedup-cost')).toHaveTextContent('Gratis'));
    expect(within(dialog).getByTestId('speedup-confirm')).toHaveTextContent('Termina gratis');
  });
});

describe('shop pieces', () => {
  const pack = (patch: Partial<Package> = {}): Package => ({
    id: 'PACK_M',
    credits: '2800',
    bonusCredits: '0',
    priceMinor: 499,
    currency: 'EUR',
    label: { key: 'creditPackage.PACK_M.name' },
    highlight: 'POPULAR',
    oneTime: false,
    available: true,
    ...patch,
  });
  it('always shows the EUR price, the highlight as icon + label and the bonus split', () => {
    state.snapshot = world({ unlocked: true });
    const onBuy = vi.fn();
    ui(
      <ul>
        <PackageCard pack={pack({ bonusCredits: '200' })} busy={false} onBuy={onBuy} />
      </ul>,
    );
    const card = screen.getByTestId('credit-package');
    expect(within(card).getByTestId('package-price')).toHaveTextContent(/4,99\s€/);
    expect(card).toHaveTextContent('Più scelto');
    expect(card).toHaveTextContent(/2\.?800 \+ 200 in omaggio/);
    fireEvent.click(within(card).getByTestId('buy-package'));
    expect(onBuy).toHaveBeenCalledTimes(1);
  });
  it('renders one-time packages that were already bought as unavailable, price still visible', () => {
    state.snapshot = world({ unlocked: true });
    ui(
      <ul>
        <PackageCard
          pack={pack({ highlight: 'STARTER', oneTime: true, available: false })}
          busy={false}
          onBuy={vi.fn()}
        />
      </ul>,
    );
    const card = screen.getByTestId('credit-package');
    expect(card).toHaveTextContent('Una sola volta');
    expect(card).toHaveTextContent('Già acquistato');
    expect(within(card).queryByTestId('buy-package')).toBeNull();
    expect(within(card).getByTestId('package-price')).toHaveTextContent('€');
  });
  it('labels every purchase status', () => {
    state.snapshot = world({ unlocked: true });
    ui(
      <>
        {(['CREATED', 'PAID', 'CREDITED', 'FAILED', 'REFUNDED'] as const).map((s) => (
          <PurchaseStatusChip key={s} status={s} />
        ))}
      </>,
    );
    for (const label of [
      'In attesa di pagamento',
      'Pagato, in accredito',
      'Accreditato',
      'Non riuscito',
      'Rimborsato',
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('referral pieces', () => {
  const referral = (patch: Partial<Referral> = {}): Referral => ({
    code: 'ABCD2345',
    inviteUrl: 'https://x.test/invite/ABCD2345',
    required: 2,
    activated: 1,
    rewardReferrer: '1500',
    rewardInvited: '500',
    rewardClaimed: false,
    activation: { missionsRequired: 5, distinctDaysRequired: 2 },
    invited: [],
    myInvitation: null,
    ...patch,
  });
  it('shows progress N/M and the claimed state', () => {
    state.snapshot = world({ unlocked: true });
    const view = ui(<NetworkProgressCard referral={referral()} />);
    expect(screen.getByTestId('network-count')).toHaveTextContent('1/2');
    expect(screen.queryByTestId('reward-claimed')).toBeNull();
    view.unmount();
    ui(<NetworkProgressCard referral={referral({ activated: 2, rewardClaimed: true })} />);
    expect(screen.getByTestId('reward-claimed')).toHaveTextContent('Premio ricevuto');
  });
  it('shows my own invitation progress only when I was invited', () => {
    state.snapshot = world({ unlocked: true });
    const none = ui(<MyInvitationCard referral={referral()} />);
    expect(none.container.querySelector('[data-testid="my-invitation"]')).toBeNull();
    none.unmount();
    ui(
      <MyInvitationCard
        referral={referral({
          myInvitation: {
            referrerName: 'Comandante Rossi',
            missionsDone: 3,
            daysDone: 1,
            status: 'REGISTERED',
          },
        })}
      />,
    );
    const card = screen.getByTestId('my-invitation');
    expect(card).toHaveTextContent('Comandante Rossi');
    expect(card).toHaveTextContent('Missioni concluse: 3/5');
    expect(card).toHaveTextContent('Giorni di gioco: 1/2');
    expect(card).toHaveTextContent('Iscritto');
  });
  it('lists invited Directors with icon + label states', () => {
    state.snapshot = world({ unlocked: true });
    ui(
      <InvitedList
        invited={[
          { directorName: 'Anna', status: 'REGISTERED', joinedAt: '2026-03-01T09:00:00.000Z' },
          { directorName: 'Bruno', status: 'REWARDED', joinedAt: '2026-03-02T09:00:00.000Z' },
          { directorName: 'Carla', status: 'INVALIDATED', joinedAt: '2026-03-03T09:00:00.000Z' },
        ]}
      />,
    );
    expect(screen.getByText('Anna')).toBeInTheDocument();
    for (const label of ['Iscritto', 'Premiato', 'Annullato'])
      expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('useWatchProgress', () => {
  it('pauses while the tab is hidden and never completes before the minimum watch time', async () => {
    vi.useFakeTimers();
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      const { result } = renderHook(() => useWatchProgress(2, true));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(result.current).toMatchObject({ done: false, paused: false });
      expect(result.current.ratio).toBeCloseTo(0.5, 1);
      act(() => setHidden(true));
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(result.current).toMatchObject({ done: false, paused: true });
      act(() => setHidden(false));
      await act(() => vi.advanceTimersByTimeAsync(1100));
      expect(result.current.done).toBe(true);
    } finally {
      setHidden(false);
      vi.useRealTimers();
    }
  });
});
