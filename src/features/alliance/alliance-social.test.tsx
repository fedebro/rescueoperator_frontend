import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { ApiClientError } from '@/lib/api/errors';
import { CAREER_ID } from '@/test/fixtures';
import { BoardTab } from './board-tab';
import { AllianceChatScreen, mentionQuery } from './chat-screen';
import {
  alliance,
  channel,
  CHANNEL_ID,
  home,
  MARTA,
  member,
  message,
  page,
  post,
  renderGame,
} from './test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/game/alliance/chat',
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  home: vi.fn(),
  members: vi.fn(),
  mute: vi.fn(),
  channels: vi.fn(),
  messages: vi.fn(),
  send: vi.fn(),
  read: vi.fn(),
  presence: vi.fn(),
  remove: vi.fn(),
  requests: vi.fn(),
  posts: vi.fn(),
  create: vi.fn(),
  boardRead: vi.fn(),
  react: vi.fn(),
  replies: vi.fn(),
}));
vi.mock('@/lib/api/alliance', () => ({
  allianceApi: { home: api.home, members: api.members, mute: api.mute },
  chatApi: {
    channels: api.channels,
    messages: api.messages,
    send: api.send,
    read: api.read,
    presence: api.presence,
    remove: api.remove,
  },
  aidApi: { requests: api.requests },
  boardApi: {
    posts: api.posts,
    create: api.create,
    read: api.boardRead,
    react: api.react,
    replies: api.replies,
  },
  moderationApi: {
    report: vi.fn(),
    block: vi.fn(),
    blocks: vi.fn().mockResolvedValue([]),
    communityRules: vi.fn(),
  },
  accountApi: {},
}));

/**
 * jsdom has no layout: the virtual list measures its container and rows through `offsetHeight` (see
 * alliance-primitives.test.tsx); the chat marks its list `chat-list`. The container is 600 px tall, every row 60 px.
 */
function mockLayout() {
  const isList = (el: HTMLElement) =>
    el.dataset.testid === 'chat-list' || el.dataset.testid === 'virtual-list';
  const positions = new WeakMap<Element, number>();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.index !== undefined ? 60 : isList(this) ? 600 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(360);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isList(this) ? 600 : 60;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (!isList(this)) return 0;
    const inner = this.querySelector<HTMLElement>(':scope > div[style]');
    return Number(inner?.style.height.replace('px', '') ?? 0);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
    return positions.get(this) ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (
    this: HTMLElement,
    v: number,
  ) {
    positions.set(this, v);
  });
  Element.prototype.scrollTo = function (this: Element, a?: ScrollToOptions | number, b?: number) {
    const top = typeof a === 'object' ? (a?.top ?? 0) : (b ?? 0);
    positions.set(this, top);
    this.dispatchEvent(new Event('scroll'));
  } as Element['scrollTo'];
}

const restrictions = home().restrictions;

beforeEach(() => {
  mockLayout();
  api.home.mockResolvedValue(home());
  api.members.mockResolvedValue([member(), MARTA]);
  api.channels.mockResolvedValue([channel()]);
  api.messages.mockResolvedValue(page([message()]));
  api.read.mockResolvedValue({ board: 0, chat: 0 });
  api.presence.mockResolvedValue({ onDuty: [], online: [], away: [] });
  api.requests.mockResolvedValue(page([]));
  api.send.mockImplementation(
    (_cid: string, _ch: string, body: { kind: string; text?: string; code?: string }) =>
      Promise.resolve(
        message({
          id: 'alx_01J8Z0000000000000000000AZ',
          mine: true,
          author: { careerId: CAREER_ID, directorName: 'Federico', role: 'COORDINATOR' },
          kind: body.kind as 'TEXT' | 'QUICK',
          text: body.text ?? null,
          quick: body.code ? { code: body.code as never, params: {} } : null,
        }),
      ),
  );
  api.posts.mockResolvedValue(page([]));
  api.boardRead.mockResolvedValue({ board: 0, chat: 0 });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('mentionQuery', () => {
  it('finds the word being typed after a free-standing @, nothing after a space or inside a word', () => {
    expect(mentionQuery('ciao @Ma', 8)).toEqual({ start: 5, query: 'Ma' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('ciao @Marta ci', 14)).toBeNull();
    expect(mentionQuery('mail@example', 12)).toBeNull();
    expect(mentionQuery('nessuna menzione', 5)).toBeNull();
  });
});

describe('alliance chat — states of the composer', () => {
  it('shows the history and sends a text; a quick phrase goes out as QUICK without touching the draft', async () => {
    const user = userEvent.setup();
    renderGame(<AllianceChatScreen />);
    expect(await screen.findByTestId('chat-message')).toHaveTextContent('Ciao a tutti');
    expect(screen.getByTestId('chat-message')).toHaveAttribute('data-mine', 'false');
    // Opening the chat marks it read (the badge drops at once).
    await waitFor(() => expect(api.read).toHaveBeenCalledWith(CAREER_ID, CHANNEL_ID));

    await user.click(screen.getByTestId('quick-COMING'));
    await waitFor(() =>
      expect(api.send).toHaveBeenCalledWith(CAREER_ID, CHANNEL_ID, { kind: 'QUICK', code: 'COMING' }),
    );

    const composer = screen.getByTestId('chat-composer');
    await user.type(composer, 'Arrivo con due mezzi');
    await user.click(screen.getByTestId('chat-send'));
    await waitFor(() =>
      expect(api.send).toHaveBeenLastCalledWith(
        CAREER_ID,
        CHANNEL_ID,
        { kind: 'TEXT', text: 'Arrivo con due mezzi', mentions: undefined },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(composer).toHaveValue(''));
  });

  it('muted: the banner says so, the quick phrases stay, the text composer is gone', async () => {
    api.home.mockResolvedValue(
      home({
        restrictions: {
          ...restrictions,
          canWriteText: false,
          canUseQuick: true,
          mutedUntil: '2026-10-06T10:00:00.000Z',
          muteScope: 'ALLIANCE',
          writeBlockedReason: 'MUTED',
        },
      }),
    );
    renderGame(<AllianceChatScreen />);
    expect(await screen.findByTestId('chat-blocked-MUTED')).toBeInTheDocument();
    expect(screen.getByTestId('quick-phrases')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-composer')).toBeNull();
  });

  it('read-only chat: the banner names the state and the quick phrases remain usable', async () => {
    api.home.mockResolvedValue(home({ alliance: alliance({ readOnly: { board: false, chat: true } }) }));
    renderGame(<AllianceChatScreen />);
    expect(await screen.findByTestId('chat-blocked-READ_ONLY')).toBeInTheDocument();
    expect(screen.getByTestId('quick-phrases')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-composer')).toBeNull();
  });

  it('rejected by the filter: the text stays in the composer, the button becomes Riprova and reuses the same key', async () => {
    const user = userEvent.setup();
    api.send.mockRejectedValueOnce(
      new ApiClientError({
        code: 'TEXT_REJECTED' as never,
        message: 'Rejected',
        status: 422,
        details: { reasons: ['PHONE'] },
      }),
    );
    renderGame(<AllianceChatScreen />);
    const composer = await screen.findByTestId('chat-composer');
    await user.type(composer, 'Chiamami al 3331234567');
    await user.click(screen.getByTestId('chat-send'));
    expect(await screen.findByTestId('chat-unsent')).toBeInTheDocument();
    expect(composer).toHaveValue('Chiamami al 3331234567');
    expect(screen.getByTestId('chat-send')).toHaveAccessibleName('Riprova');

    await user.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
    const [first, second] = api.send.mock.calls as unknown[][];
    expect(second![3]).toBe(first![3]);
    await waitFor(() => expect(screen.queryByTestId('chat-unsent')).toBeNull());
  });

  it('typing @ opens the member picker; picking inserts @Nome and the mention travels with the message', async () => {
    const user = userEvent.setup();
    renderGame(<AllianceChatScreen />);
    const composer = await screen.findByTestId('chat-composer');
    await user.type(composer, 'Ehi @Ma');
    const picker = await screen.findByTestId('mention-picker');
    await user.click(within(picker).getByRole('option', { name: /Marta/ }));
    expect(composer).toHaveValue('Ehi @Marta ');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    await user.click(screen.getByTestId('chat-send'));
    await waitFor(() =>
      expect(api.send).toHaveBeenLastCalledWith(
        CAREER_ID,
        CHANNEL_ID,
        { kind: 'TEXT', text: 'Ehi @Marta', mentions: [MARTA.careerId] },
        expect.any(String),
      ),
    );
  });
});

describe('alliance board', () => {
  const noop = vi.fn();
  const renderBoard = (h = home(), a = h.alliance!) =>
    renderGame(
      <BoardTab
        home={h}
        alliance={a}
        careerId={CAREER_ID}
        onOpenMember={noop}
        onReport={noop}
        onBlock={noop}
        onRules={noop}
      />,
    );

  it('the coordinator composes a note with the limits from the config; pinned posts sit on top; a reaction is one tap', async () => {
    const user = userEvent.setup();
    api.posts.mockResolvedValue(
      page([
        post({
          id: 'alp_01J8Z0000000000000000000AB',
          kind: 'ANNOUNCEMENT',
          text: 'Turno lungo stasera',
          pinned: true,
          pinnedAt: T0,
        }),
        post(),
      ]),
    );
    api.create.mockResolvedValue(
      post({ id: 'alp_01J8Z0000000000000000000AC', mine: true, text: 'Benvenuti' }),
    );
    api.react.mockResolvedValue(post({ reactions: [{ reaction: 'ACK', count: 1, mine: true }] }));
    renderBoard();
    const posts = await screen.findAllByTestId('board-post');
    expect(posts).toHaveLength(2);
    // Pinned first, with the "Fissato" badge.
    expect(posts[0]).toHaveAttribute('data-pinned', 'true');
    expect(posts[0]).toHaveTextContent('Turno lungo stasera');
    expect(within(posts[0]!).getByTestId('board-pinned')).toHaveTextContent('Fissato');
    await waitFor(() => expect(api.boardRead).toHaveBeenCalledWith(CAREER_ID));
    const composer = screen.getByTestId('board-composer');
    expect(composer).toHaveTextContent('5 post');
    expect(composer).toHaveTextContent('15 minuti');
    expect(screen.getByTestId('board-post-button')).toBeDisabled();
    await user.type(screen.getByTestId('board-textarea'), 'Benvenuti');
    await user.click(screen.getByTestId('board-post-button'));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(CAREER_ID, { kind: 'NOTE', text: 'Benvenuti', pin: undefined }),
    );

    const marta = screen.getAllByTestId('board-post').find((p) => p.textContent?.includes('Nota di Marta'))!;
    await user.click(within(marta).getByTestId('reaction-ACK'));
    await waitFor(() =>
      expect(api.react).toHaveBeenCalledWith(
        CAREER_ID,
        'alp_01J8Z0000000000000000000AA',
        expect.objectContaining({ reaction: 'ACK' }),
      ),
    );
  });

  it('without the rules accepted there is no composer: the line explains and leads to the rules', async () => {
    const user = userEvent.setup();
    const onRules = vi.fn();
    renderGame(
      <BoardTab
        home={home({
          restrictions: {
            ...restrictions,
            rulesAccepted: false,
            canWriteText: false,
            writeBlockedReason: 'RULES_NOT_ACCEPTED',
          },
        })}
        alliance={alliance()}
        careerId={CAREER_ID}
        onOpenMember={noop}
        onReport={noop}
        onBlock={noop}
        onRules={onRules}
      />,
    );
    expect(await screen.findByTestId('write-blocked-RULES_NOT_ACCEPTED')).toBeInTheDocument();
    expect(screen.queryByTestId('board-composer')).toBeNull();
    await user.click(screen.getByTestId('write-blocked-rules'));
    expect(onRules).toHaveBeenCalled();
  });

  it('a read-only board shows the notice and no composer, whatever the role', async () => {
    renderBoard(home({ alliance: alliance({ readOnly: { board: true, chat: false } }) }));
    expect(await screen.findByTestId('board-read-only')).toBeInTheDocument();
    expect(screen.queryByTestId('board-composer')).toBeNull();
  });
});

const T0 = '2026-10-06T09:00:00.000Z';
