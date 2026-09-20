import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { SyncSnapshot } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { CAREER_ID, INCIDENT_ID, incident, snapshot } from '@/test/fixtures';
import { renderWithIntl } from '@/test/render';
import { setAnalyticsSink } from '@/lib/analytics';
import { useUiStore } from '@/stores/ui';
import { CareerProvider } from '@/features/game/hooks';
import type { Notification } from './notifications-model';
import { NotificationsButton } from './notifications-center';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const api = vi.hoisted(() => ({
  notifications: vi.fn(),
  readNotification: vi.fn(),
  readAllNotifications: vi.fn(),
}));
vi.mock('@/lib/api/depth', () => ({ platformApi: api }));

const n = (patch: Partial<Notification>): Notification => ({
  id: 'ntf_01J8Z0000000000000000000AA',
  category: 'SYSTEM',
  priority: 'INFO',
  title: { key: 'notifications.qa.SYSTEM' },
  body: { key: 'notifications.qa.SYSTEM' },
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  readAt: null,
  action: { kind: 'NONE', targetId: null },
  ...patch,
});

const LIST: Notification[] = [
  n({
    id: 'ntf_1',
    category: 'OPERATIONS',
    priority: 'CRITICAL',
    title: { key: 'notifications.qa.OPERATIONS' },
    body: { key: 'notifications.qaBody.CRITICAL' },
    action: { kind: 'OPEN_INCIDENT', targetId: INCIDENT_ID },
  }),
  n({
    id: 'ntf_2',
    category: 'PROGRESSION',
    priority: 'IMPORTANT',
    title: { key: 'notifications.levelUp', params: { level: 3 } },
    body: { key: 'notifications.levelUp', params: { level: 3 } },
    action: { kind: 'OPEN_PROGRESSION', targetId: null },
  }),
  n({ id: 'ntf_3', readAt: new Date().toISOString() }),
];

function mount(unread = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<SyncSnapshot>(
    qk.sync(CAREER_ID),
    snapshot({ unreadNotifications: unread, incidents: [incident()] }),
  );
  renderWithIntl(
    <QueryClientProvider client={client}>
      <CareerProvider value={CAREER_ID}>
        <NotificationsButton />
      </CareerProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  push.mockClear();
  api.notifications.mockReset().mockResolvedValue(LIST);
  api.readNotification.mockReset().mockResolvedValue(undefined);
  api.readAllNotifications.mockReset().mockResolvedValue(undefined);
  useUiStore.setState({ selection: null });
});

describe('NotificationsButton', () => {
  it('shows the unread badge in the accessible name and lists notifications with priority, category and time', async () => {
    mount();
    const bell = screen.getByRole('button', { name: 'Notifiche, 2 non lette' });
    expect(within(bell).getByTestId('notifications-badge')).toHaveTextContent('2');
    fireEvent.click(bell);
    const dialog = await screen.findByRole('dialog', { name: 'Notifiche' });
    const items = await within(dialog).findAllByTestId('notification-item');
    expect(items).toHaveLength(3);
    // priority is icon + label, never colour alone
    expect(within(items[0]!).getByText('Critica')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Operazioni')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Richiede un intervento immediato.')).toBeInTheDocument();
    expect(within(items[0]!).getByText(/5 minuti fa/)).toBeInTheDocument();
    // body identical to the title → rendered once
    expect(within(items[1]!).getAllByText('Livello 3 raggiunto!')).toHaveLength(1);
    expect(items[2]).toHaveAttribute('data-unread', 'false');
  });

  it('filters by category and unread-only, with a dedicated empty state', async () => {
    mount();
    fireEvent.click(screen.getByTestId('notifications-button'));
    await screen.findAllByTestId('notification-item');
    fireEvent.click(screen.getByTestId('notifications-filter-PROGRESSION'));
    expect(screen.getAllByTestId('notification-item')).toHaveLength(1);
    expect(screen.getByTestId('notifications-filter-PROGRESSION')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('notifications-filter-ALL'));
    fireEvent.click(screen.getByTestId('notifications-unread-only'));
    expect(screen.getAllByTestId('notification-item')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('notifications-filter-FLEET'));
    expect(screen.getByText('Niente con questi filtri')).toBeInTheDocument();
  });

  it('click = optimistic read + direct action (incident selected on the map) + analytics', async () => {
    const tracked = vi.fn();
    setAnalyticsSink(tracked);
    const client = mount();
    fireEvent.click(screen.getByTestId('notifications-button'));
    const items = await screen.findAllByTestId('notification-item');
    fireEvent.click(items[0]!);
    await waitFor(() => expect(api.readNotification).toHaveBeenCalledWith(CAREER_ID, 'ntf_1'));
    expect(client.getQueryData<SyncSnapshot>(qk.sync(CAREER_ID))!.unreadNotifications).toBe(1);
    expect(push).toHaveBeenCalledWith('/game');
    expect(useUiStore.getState().selection).toEqual({ kind: 'incident', id: INCIDENT_ID });
    expect(tracked).toHaveBeenCalledWith('notification_opened', {
      notificationId: 'ntf_1',
      category: 'OPERATIONS',
      priority: 'CRITICAL',
      action: 'OPEN_INCIDENT',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    setAnalyticsSink(() => undefined);
  });

  it('read-all clears the badge optimistically and rolls back when the server refuses', async () => {
    const client = mount();
    fireEvent.click(screen.getByTestId('notifications-button'));
    await screen.findAllByTestId('notification-item');
    api.readAllNotifications.mockRejectedValueOnce(new Error('nope'));
    fireEvent.click(screen.getByTestId('notifications-read-all'));
    expect(client.getQueryData<SyncSnapshot>(qk.sync(CAREER_ID))!.unreadNotifications).toBe(0);
    await waitFor(() =>
      expect(client.getQueryData<SyncSnapshot>(qk.sync(CAREER_ID))!.unreadNotifications).toBe(2),
    );
    // The server now agrees: the refetch after the mutation returns everything as read.
    api.notifications.mockResolvedValue(
      LIST.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })),
    );
    fireEvent.click(screen.getByTestId('notifications-read-all'));
    await waitFor(() => expect(screen.getByTestId('notifications-read-all')).toBeDisabled());
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
  });

  it('has loading, error (with retry) and empty states', async () => {
    let resolve!: (v: Notification[]) => void;
    api.notifications.mockReturnValueOnce(new Promise<Notification[]>((r) => (resolve = r)));
    mount(0);
    fireEvent.click(screen.getByTestId('notifications-button'));
    expect(await screen.findByTestId('notifications-loading')).toBeInTheDocument();
    resolve([]);
    expect(await screen.findByText('Nessuna notifica')).toBeInTheDocument();
  });

  it('error state offers a retry', async () => {
    api.notifications.mockRejectedValueOnce(new Error('down'));
    mount(0);
    fireEvent.click(screen.getByTestId('notifications-button'));
    expect(await screen.findByText('Impossibile caricare le notifiche')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findAllByTestId('notification-item')).toHaveLength(3);
  });
});
