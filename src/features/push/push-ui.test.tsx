import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PushConfigDto, PushPreferencesDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { CAREER_ID, snapshot } from '@/test/fixtures';
import {
  SERVER_KEY,
  fakeRegistration,
  installServiceWorker,
  uninstallServiceWorker,
} from '@/test/push-fakes';
import { renderWithIntl } from '@/test/render';
import { useToastStore } from '@/stores/toast';
import { CareerProvider } from '@/features/game/hooks';
import type * as EnvironmentModule from './environment';
import type { PushEnvironment } from './environment';

const env = vi.hoisted(() => ({
  current: {
    supported: true,
    permission: 'default',
    ios: false,
    iosPushCapable: false,
    standalone: false,
    inApp: false,
    android: false,
    macSafari: false,
  } as PushEnvironment,
}));
vi.mock('./environment', async (original) => ({
  ...(await original<typeof EnvironmentModule>()),
  readPushEnvironment: () => ({ ...env.current }),
}));

const api = vi.hoisted(() => ({
  config: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  preferences: vi.fn(),
  updatePreferences: vi.fn(),
  test: vi.fn(),
}));
vi.mock('./api', () => ({ pushApi: api }));

const { PushRuntime, PROMPT_DELAY_MS } = await import('./push-prompt');
const { PushSettings } = await import('./push-settings');
const { usePushStore } = await import('./store');
const { RELEASE_ID } = await import('./release');

const CONFIG: PushConfigDto = {
  enabled: true,
  vapidPublicKey: SERVER_KEY,
  categories: [
    { code: 'INCIDENT_NEW', defaultEnabled: true },
    { code: 'ECONOMY', defaultEnabled: false },
  ],
};
const PREFS: PushPreferencesDto = {
  categories: [
    { code: 'INCIDENT_NEW', enabled: true },
    { code: 'ECONOMY', enabled: false },
  ],
  quietHours: { enabled: false, start: '23:00', end: '07:00', timeZone: 'Europe/Rome' },
};

/** The browser's `Notification`: `requestPermission` answers `answer` and records whether it ran synchronously. */
function installNotification(permission: NotificationPermission, answer: NotificationPermission = 'granted') {
  const request = vi.fn(async () => {
    env.current = { ...env.current, permission: answer };
    return answer;
  });
  globalThis.Notification = { permission, requestPermission: request } as unknown as typeof Notification;
  return request;
}

function mount(ui: React.ReactElement, config: PushConfigDto = CONFIG) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.pushConfig, config);
  client.setQueryData(qk.sync(CAREER_ID), snapshot());
  renderWithIntl(
    <QueryClientProvider client={client}>
      <CareerProvider value={CAREER_ID}>{ui}</CareerProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  env.current = {
    ...env.current,
    supported: true,
    permission: 'default',
    ios: false,
    iosPushCapable: false,
    standalone: false,
    inApp: false,
  };
  usePushStore.setState({ promptedRelease: null, optedOut: false, synced: null });
  useToastStore.setState({ toasts: [] });
  api.config.mockResolvedValue(CONFIG);
  api.subscribe.mockReset().mockResolvedValue({ id: 'psb_01J8Z0000000000000000000AA' });
  api.unsubscribe.mockReset().mockResolvedValue(undefined);
  api.preferences.mockReset().mockResolvedValue(PREFS);
  api.updatePreferences
    .mockReset()
    .mockImplementation(async (_c: string, body: Partial<PushPreferencesDto>) => ({
      categories: PREFS.categories.map((c) => body.categories?.find((n) => n.code === c.code) ?? c),
      quietHours: body.quietHours ?? PREFS.quietHours,
    }));
  api.test.mockReset().mockResolvedValue({ sent: 1 });
});
afterEach(() => {
  vi.useRealTimers();
  uninstallServiceWorker();
});

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

describe('PushRuntime — the permission sheet (D-98)', () => {
  it('asks a few seconds in; "Attiva notifiche" starts the browser prompt in the tap, subscribes and registers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { registration, pushManager } = fakeRegistration();
    installServiceWorker(registration);
    const request = installNotification('default', 'granted');
    mount(<PushRuntime tutorialCompleted />);
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    await act(async () => void vi.advanceTimersByTime(PROMPT_DELAY_MS + 10));
    const sheet = await screen.findByRole('dialog', { name: 'Non perdere nessuna emergenza' });
    expect(sheet).toHaveAttribute('data-variant', 'ask');
    expect(within(sheet).getByTestId('push-benefits').querySelectorAll('li')).toHaveLength(4);
    // Counted as asked as soon as it is on screen.
    expect(usePushStore.getState().promptedRelease).toBe(RELEASE_ID);

    fireEvent.click(within(sheet).getByTestId('push-prompt-enable'));
    expect(request).toHaveBeenCalledTimes(1); // synchronously, inside the click
    await waitFor(() => expect(api.subscribe).toHaveBeenCalledTimes(1));
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(api.subscribe.mock.calls[0]![1]).toMatchObject({ platform: 'BROWSER' });
    await waitFor(() => expect(screen.queryByTestId('push-prompt')).toBeNull());
    expect(toastTitles()).toContain('Notifiche attive su questo dispositivo');
  });

  it('"Non ora" closes it and it does not come back in this release', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installNotification('default');
    mount(<PushRuntime tutorialCompleted />);
    await act(async () => void vi.advanceTimersByTime(PROMPT_DELAY_MS + 10));
    fireEvent.click(await screen.findByTestId('push-prompt-later'));
    await waitFor(() => expect(screen.queryByTestId('push-prompt')).toBeNull());
    await act(async () => void vi.advanceTimersByTime(PROMPT_DELAY_MS * 4));
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it('never during the tutorial', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installNotification('default');
    mount(<PushRuntime tutorialCompleted={false} />);
    await act(async () => void vi.advanceTimersByTime(PROMPT_DELAY_MS * 6));
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    expect(usePushStore.getState().promptedRelease).toBeNull();
  });

  it('waits for a calm moment: not on top of another dialog', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installNotification('default');
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.appendChild(other);
    mount(<PushRuntime tutorialCompleted />);
    await act(async () => void vi.advanceTimersByTime(PROMPT_DELAY_MS * 3));
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    other.remove();
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(await screen.findByTestId('push-prompt')).toBeInTheDocument();
  });

  it('blocked in the browser: once per release, how to allow them again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    env.current = { ...env.current, permission: 'denied' };
    installNotification('denied');
    mount(<PushRuntime tutorialCompleted />);
    await act(async () => void vi.advanceTimersByTime(PROMPT_DELAY_MS + 10));
    const sheet = await screen.findByRole('dialog', { name: 'Notifiche bloccate' });
    expect(within(sheet).getByTestId('push-denied-help')).toHaveAttribute('data-help', 'browser');
    expect(within(sheet).queryByTestId('push-prompt-enable')).toBeNull();
    fireEvent.click(within(sheet).getByTestId('push-prompt-later'));
    await waitFor(() => expect(screen.queryByTestId('push-prompt')).toBeNull());
  });

  it('iPhone Safari: explains the Home Screen app with the install steps', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    env.current = { ...env.current, ios: true, iosPushCapable: true, supported: false, permission: null };
    mount(<PushRuntime tutorialCompleted />);
    await act(async () => void vi.advanceTimersByTime(PROMPT_DELAY_MS + 10));
    const sheet = await screen.findByRole('dialog', { name: 'Notifiche su iPhone e iPad' });
    expect(within(sheet).getByTestId('ios-install-steps').querySelectorAll('li')).toHaveLength(4);
  });

  it('granted: re-subscribes silently, no sheet', async () => {
    const { registration } = fakeRegistration();
    installServiceWorker(registration);
    env.current = { ...env.current, permission: 'granted' };
    installNotification('granted');
    mount(<PushRuntime tutorialCompleted />);
    await waitFor(() => expect(api.subscribe).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('push-prompt')).toBeNull();
  });
});

describe('PushSettings — Settings → Notifiche push', () => {
  it('turns push on and off on this device, sends a test, edits categories and quiet hours', async () => {
    const { registration } = fakeRegistration();
    installServiceWorker(registration);
    const request = installNotification('default', 'granted');
    mount(<PushSettings />);
    const card = screen.getByTestId('push-settings');
    await waitFor(() => expect(card).toHaveAttribute('data-status', 'off'));
    expect(within(card).getByTestId('push-status')).toHaveTextContent('Non attive');

    fireEvent.click(within(card).getByTestId('push-device-toggle'));
    expect(request).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(card).toHaveAttribute('data-status', 'on'));
    expect(api.subscribe).toHaveBeenCalledTimes(1);

    fireEvent.click(within(card).getByTestId('push-test'));
    await waitFor(() => expect(api.test).toHaveBeenCalledWith(CAREER_ID));
    await waitFor(() => expect(toastTitles()).toContain('Notifica di prova inviata'));

    // Categories apply to every device of the account.
    const economy = await within(card).findByTestId('push-category-toggle-ECONOMY');
    expect(economy).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(economy);
    await waitFor(() =>
      expect(api.updatePreferences).toHaveBeenCalledWith(CAREER_ID, {
        categories: [{ code: 'ECONOMY', enabled: true }],
      }),
    );
    await waitFor(() => expect(economy).toHaveAttribute('aria-checked', 'true'));

    fireEvent.click(within(card).getByTestId('push-quiet-toggle'));
    await waitFor(() =>
      expect(api.updatePreferences).toHaveBeenLastCalledWith(CAREER_ID, {
        quietHours: expect.objectContaining({
          enabled: true,
          start: '23:00',
          end: '07:00',
          timeZone: expect.any(String),
        }),
      }),
    );
    const from = await within(card).findByTestId('push-quiet-start');
    const input = from.querySelector('input') ?? (from as HTMLInputElement);
    fireEvent.change(input, { target: { value: '22:00' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(api.updatePreferences).toHaveBeenLastCalledWith(CAREER_ID, {
        quietHours: expect.objectContaining({ enabled: true, start: '22:00', end: '07:00' }),
      }),
    );

    fireEvent.click(within(card).getByTestId('push-device-toggle'));
    await waitFor(() => expect(card).toHaveAttribute('data-status', 'off'));
    expect(api.unsubscribe).toHaveBeenCalledWith(CAREER_ID, expect.stringMatching(/^https:\/\//));
    expect(usePushStore.getState().optedOut).toBe(true);
  });

  it('a refused save rolls back and says why in the player’s words', async () => {
    const { ApiClientError } = await import('@/lib/api/errors');
    api.updatePreferences.mockRejectedValueOnce(
      new ApiClientError({
        code: 'VALIDATION_ERROR',
        message: 'bad zone',
        status: 400,
        details: { reason: 'INVALID_TIME_ZONE' },
      }),
    );
    env.current = { ...env.current, permission: 'granted' };
    installServiceWorker(fakeRegistration().registration);
    mount(<PushSettings />);
    const card = screen.getByTestId('push-settings');
    const quiet = await within(card).findByTestId('push-quiet-toggle');
    fireEvent.click(quiet);
    await waitFor(() =>
      expect(toastTitles()).toContain(
        'Il fuso orario di questo dispositivo non è riconosciuto: le ore di silenzio non sono state salvate.',
      ),
    );
    await waitFor(() => expect(quiet).toHaveAttribute('aria-checked', 'false'));
  });

  it('blocked: the switch is disabled and the card says how to allow them again', async () => {
    env.current = { ...env.current, permission: 'denied' };
    installNotification('denied');
    mount(<PushSettings />);
    const card = screen.getByTestId('push-settings');
    await waitFor(() => expect(card).toHaveAttribute('data-status', 'denied'));
    expect(within(card).getByTestId('push-device-toggle')).toBeDisabled();
    expect(within(card).getByTestId('push-denied-help')).toBeInTheDocument();
  });

  it('iPhone Safari: points to the Home Screen app', async () => {
    env.current = { ...env.current, ios: true, iosPushCapable: true, supported: false, permission: null };
    mount(<PushSettings />);
    const card = screen.getByTestId('push-settings');
    await waitFor(() => expect(card).toHaveAttribute('data-status', 'ios-install'));
    fireEvent.click(within(card).getByTestId('push-ios-install'));
    expect(await screen.findByTestId('ios-install-steps')).toBeInTheDocument();
  });

  it('push off on the server: says so, nothing else', async () => {
    mount(<PushSettings />, { ...CONFIG, enabled: false, vapidPublicKey: null });
    const card = screen.getByTestId('push-settings');
    await waitFor(() => expect(card).toHaveAttribute('data-status', 'unavailable'));
    expect(within(card).getByTestId('push-device-toggle')).toBeDisabled();
    expect(within(card).queryByTestId('push-categories')).toBeNull();
    expect(api.preferences).not.toHaveBeenCalled();
  });
});
