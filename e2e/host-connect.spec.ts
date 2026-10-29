import { expect, test } from '@playwright/test';
import { lifeOf, panel, startFourPlayerGame } from './helpers';

// Runs in the 'relay' project against the real server (server/index.ts) with the built app.

test('host shares a room, a raw remote claims p2 and changes its life', async ({ page, browser }) => {
  await startFourPlayerGame(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Połącz telefony/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Połącz telefony' });
  const code = sheet.locator('.room-code');
  await expect(code).toHaveText(/^[A-Z2-9]{5}$/);
  const room = (await code.textContent())!;
  // one QR per player plus the generic one
  await expect(sheet.locator('.qr svg')).toHaveCount(5);
  await expect(sheet.locator('.qr-status').first()).toHaveText('wolny');

  // A second, independent browser context plays the phone with a bare WebSocket.
  const phoneCtx = await browser.newContext();
  const phone = await phoneCtx.newPage();
  await phone.goto('/healthz');
  await phone.evaluate((roomCode) => {
    const w = window as unknown as { ws: WebSocket; log: unknown[] };
    w.log = [];
    w.ws = new WebSocket(`ws://${location.host}/ws`);
    w.ws.onmessage = (e) => w.log.push(JSON.parse(e.data));
    w.ws.onopen = () => {
      w.ws.send(JSON.stringify({ t: 'join', room: roomCode, clientId: 'e2e-client-0001', name: 'Tester' }));
      w.ws.send(JSON.stringify({ t: 'claim', playerId: 'p2' }));
      w.ws.send(JSON.stringify({ t: 'action', action: { type: 'adjustLife', playerId: 'p2', delta: -3 } }));
    };
  }, room);

  await expect(sheet.locator('.qr-card[data-player="p2"] .qr-status')).toHaveText('połączony: Tester');
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(lifeOf(page, 1)).toHaveText('37');
  await expect(panel(page, 1).locator('.p-remote')).toBeVisible();
  await expect(panel(page, 0).locator('.p-remote')).toHaveCount(0);

  // Illegal: the seat holder tries to change someone else's life, and a host-only action.
  await phone.evaluate(() => {
    const w = window as unknown as { ws: WebSocket };
    w.ws.send(JSON.stringify({ t: 'action', action: { type: 'adjustLife', playerId: 'p1', delta: -5 } }));
    w.ws.send(JSON.stringify({ t: 'action', action: { type: 'setSeating', seating: 'ends' } }));
  });
  await expect
    .poll(() => phone.evaluate(() => (window as unknown as { log: { t: string }[] }).log.filter((m) => m.t === 'refused').length))
    .toBe(2);
  await expect(lifeOf(page, 0)).toHaveText('40');
  await expect(lifeOf(page, 1)).toHaveText('37');

  // The remote received the authoritative state with its seat.
  const lastState = await phone.evaluate(() => {
    const log = (window as unknown as { log: { t: string; seats: Record<string, string | null> }[] }).log;
    return log.filter((m) => m.t === 'state').at(-1)!.seats;
  });
  expect(lastState.p2).toBe('e2e-client-0001');

  // Host frees the seat.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Połącz telefony/ }).click();
  await sheet.locator('.qr-card[data-player="p2"]').getByRole('button', { name: 'Zwolnij' }).click();
  await expect(sheet.locator('.qr-card[data-player="p2"] .qr-status')).toHaveText('wolny');
  await sheet.getByRole('button', { name: 'Zakończ udostępnianie' }).click();
  await expect(sheet).toHaveCount(0);
  await phoneCtx.close();
});

test('room code survives a host reload', async ({ page }) => {
  await startFourPlayerGame(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Połącz telefony/ }).click();
  const code = page.locator('.room-code');
  await expect(code).toHaveText(/^[A-Z2-9]{5}$/);
  const room = await code.textContent();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.locator('.tb-time .conn-dot.open')).toBeVisible();

  // wait for the debounced game save, then reload
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.panel')).toHaveCount(4);
  await expect(page.locator('.tb-time .conn-dot.open')).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Połącz telefony/ }).click();
  await expect(page.locator('.room-code')).toHaveText(room!);
});
