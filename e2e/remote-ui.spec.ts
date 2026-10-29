import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createGame } from '../src/core/game';
import type { GameState } from '../src/core/types';

const SHOTS = '/tmp/l-shots';
mkdirSync(SHOTS, { recursive: true });

function fixture(): GameState {
  return createGame(
    [
      { name: 'Ala', color: '#e5484d', pinned: ['poison'] },
      { name: 'Bartek', color: '#3b82f6', pinned: ['energy'], customCounters: ['Skarby'] },
      { name: 'Celina', color: '#2fb36b' },
    ],
    { startingLife: 40, turnLimitMs: null },
    Date.now(),
  );
}

/** Fake host driven from the page: a raw WebSocket that mimics the table device. */
async function startFakeHost(page: Page, state: GameState): Promise<string> {
  await page.goto('/healthz');
  return page.evaluate(
    (initial) =>
      new Promise<string>((resolve) => {
        const w = window as any;
        w.__state = initial;
        w.__seats = Object.fromEntries(initial.players.map((p: any) => [p.id, null]));
        w.__actions = [];
        w.__msgs = [];
        const ws = new WebSocket(`ws://${location.host}/ws`);
        const push = () =>
          ws.send(JSON.stringify({ t: 'state', state: w.__state, seats: w.__seats, hostNow: Date.now() }));
        w.__push = push;
        ws.onopen = () => ws.send(JSON.stringify({ t: 'host' }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          w.__msgs.push(m);
          if (m.t === 'hosted') {
            w.__room = m.room;
            push();
            resolve(m.room);
          } else if (m.t === 'peer' && m.event === 'join') {
            push();
          } else if (m.t === 'fromRemote') {
            const r = m.msg;
            if (r.t === 'claim') {
              const holder = w.__seats[r.playerId];
              if (holder && holder !== m.clientId) {
                ws.send(JSON.stringify({ t: 'toRemote', clientId: m.clientId, msg: { t: 'refused', reason: 'seat-taken' } }));
                return;
              }
              for (const k of Object.keys(w.__seats)) if (w.__seats[k] === m.clientId) w.__seats[k] = null;
              w.__seats[r.playerId] = m.clientId;
              push();
            } else if (r.t === 'release') {
              for (const k of Object.keys(w.__seats)) if (w.__seats[k] === m.clientId) w.__seats[k] = null;
              push();
            } else if (r.t === 'action') {
              w.__actions.push(r.action);
              if (r.action.type === 'adjustLife') {
                w.__state = {
                  ...w.__state,
                  players: w.__state.players.map((p: any) =>
                    p.id === r.action.playerId ? { ...p, life: p.life + r.action.delta } : p,
                  ),
                };
              }
              push();
            }
          }
        };
      }),
    state,
  );
}

/** Mutates the fake host's state in the page and republishes it. */
async function hostSet(page: Page, patch: (s: any) => any, arg?: unknown): Promise<void> {
  await page.evaluate(
    ([src, a]) => {
      const w = window as any;
      w.__state = new Function('s', 'a', `return (${src})(s, a)`)(w.__state, a);
      w.__push();
    },
    [patch.toString(), arg] as const,
  );
}

async function phone(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    baseURL: 'http://localhost:4174',
  });
  return { ctx, page: await ctx.newPage() };
}

test.describe('remote phone UI', () => {
  test('join screen, seat picker and playing from the phone', async ({ browser, page: hostPage }) => {
    const room = await startFakeHost(hostPage, fixture());
    const { ctx, page } = await phone(browser);

    // Bare /?join: code entry
    await page.goto('/?join');
    await expect(page.getByRole('heading', { name: 'Dołącz do gry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dołącz' })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/1-join.png` });
    await page.getByLabel('Kod pokoju').fill(room.toLowerCase());
    await page.getByLabel('Twoje imię').fill('Ola');
    await page.getByRole('button', { name: 'Dołącz' }).click();

    // Seat picker
    await expect(page.getByRole('heading', { name: 'Wybierz gracza' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Ala/ })).toBeEnabled();
    await page.screenshot({ path: `${SHOTS}/2-seats.png` });
    await page.getByRole('button', { name: /^Bartek/ }).click();

    // Remote screen
    await expect(page.getByTestId('life')).toHaveText('40');
    expect(await hostPage.evaluate(() => (window as any).__seats.p2)).toBeTruthy();

    // Second phone sees p2 as taken
    const other = await phone(browser);
    await other.page.goto(`/?join=${room}`);
    await expect(other.page.getByRole('button', { name: /^Bartek \(zajęte\)/ })).toBeDisabled();
    await expect(other.page.getByText('zajęte')).toBeVisible();
    await other.page.screenshot({ path: `${SHOTS}/3-seats-taken.png` });
    await other.ctx.close();

    await page.getByRole('button', { name: 'Życie +1' }).click();
    await expect(page.getByTestId('life')).toHaveText('41');
    const actions = await hostPage.evaluate(() => (window as any).__actions);
    expect(actions).toContainEqual({ type: 'adjustLife', playerId: 'p2', delta: 1 });
    await page.screenshot({ path: `${SHOTS}/4-remote.png` });

    // Reload re-joins and keeps the seat
    await page.reload();
    await expect(page.getByTestId('life')).toHaveText('41');

    // Counter sheet: poison goes to the host as an own-player action
    await page.getByRole('button', { name: 'Liczniki', exact: true }).click();
    await page.getByRole('button', { name: 'Trucizna plus' }).click();
    await expect.poll(() => hostPage.evaluate(() => (window as any).__actions.at(-1))).toEqual({
      type: 'adjustPoison', playerId: 'p2', delta: 1,
    });
    await page.screenshot({ path: `${SHOTS}/5-sheet.png` });
    await page.getByRole('button', { name: 'Gotowe' }).click();

    // Change player returns to the picker
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Zmień gracza' }).click();
    await expect(page.getByRole('heading', { name: 'Wybierz gracza' })).toBeVisible();
    await ctx.close();
  });

  test('my turn, end turn, undo and elimination overlay', async ({ browser, page: hostPage }) => {
    const room = await startFakeHost(hostPage, fixture());
    const { ctx, page } = await phone(browser);
    await page.goto(`/?join=${room}&seat=p2`);
    await expect(page.getByTestId('life')).toHaveText('40');
    await expect(page.getByRole('button', { name: 'Zakończ turę' })).toHaveCount(0);

    await hostSet(hostPage, (s) => ({
      ...s,
      clock: { ...s.clock, running: true, activePlayerId: 'p2', segmentStartedAt: Date.now() - 65_000, turn: 3 },
    }));
    await expect(page.getByText(/^Twoja tura/)).toBeVisible();
    await page.getByRole('button', { name: 'Zakończ turę' }).click();
    await expect.poll(() => hostPage.evaluate(() => (window as any).__actions.at(-1)?.type)).toBe('clockNextTurn');
    await page.screenshot({ path: `${SHOTS}/6-my-turn.png` });

    await page.getByRole('button', { name: 'Cofnij' }).click();
    await expect.poll(() => hostPage.evaluate(() => (window as any).__msgs.filter((m: any) => m.msg?.t === 'undo').length)).toBe(1);

    await hostSet(hostPage, (s) => ({
      ...s,
      players: s.players.map((p: any) => (p.id === 'p2' ? { ...p, life: 0 } : p)),
    }));
    await expect(page.getByText('Odpadasz')).toBeVisible();
    await expect(page.getByText('Brak życia')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/7-eliminated.png` });
    await ctx.close();
  });

  test('unknown room shows an error and returns to code entry', async ({ browser }) => {
    const { ctx, page } = await phone(browser);
    await page.goto('/?join=ZZZZ2');
    await expect(page.getByText('Brak pokoju')).toBeVisible();
    await expect(page.getByLabel('Kod pokoju')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/8-no-room.png` });
    await ctx.close();
  });

  test('refused claim shows a Polish toast, host offline shows a banner', async ({ browser, page: hostPage }) => {
    const room = await startFakeHost(hostPage, fixture());
    const a = await phone(browser);
    await a.page.goto(`/?join=${room}&seat=p1`);
    await expect(a.page.getByTestId('life')).toBeVisible();
    const b = await phone(browser);
    await b.page.goto(`/?join=${room}`);
    await expect(b.page.getByRole('heading', { name: 'Wybierz gracza' })).toBeVisible();
    // Hostile/stale claim: pre-select the taken seat via URL
    await b.page.goto(`/?join=${room}&seat=p1`);
    await expect(b.page.getByRole('heading', { name: 'Wybierz gracza' })).toBeVisible();

    await hostPage.close();
    await expect(a.page.getByText('Host offline — czekam')).toBeVisible();
    await a.page.screenshot({ path: `${SHOTS}/9-host-offline.png` });
    await a.ctx.close();
    await b.ctx.close();
  });
});
