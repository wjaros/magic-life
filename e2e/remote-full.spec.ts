import { expect, test } from '@playwright/test';
import { lifeOf, panel, startFourPlayerGame } from './helpers';

// Real host UI + real phone UI over the real relay server ('relay' project).

test('phone joins via QR link, controls only its own tile, ends its turn', async ({ page, browser }) => {
  await startFourPlayerGame(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Połącz telefony/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Połącz telefony' });
  const room = (await sheet.locator('.room-code').textContent())!;
  expect(room).toMatch(/^[A-Z2-9]{5}$/);

  // The phone opens the per-seat join link, as encoded in player 2's QR code.
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await phoneCtx.newPage();
  await phone.goto(`/?join=${room}&seat=p2`);
  await expect(phone.getByTestId('life')).toHaveText('40');
  await expect(sheet.locator('.qr-card[data-player="p2"] .qr-status')).toHaveText(/^połączony/);
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(panel(page, 1).locator('.p-remote')).toBeVisible();

  // Phone taps reach the host, and the host's own taps reach the phone.
  await phone.getByRole('button', { name: 'Życie +1' }).click();
  await phone.getByRole('button', { name: 'Życie +1' }).click();
  await expect(lifeOf(page, 1)).toHaveText('42');
  await expect(phone.getByTestId('life')).toHaveText('42');
  await page.getByRole('button', { name: /Gracz 2: życie −1/ }).click();
  await expect(phone.getByTestId('life')).toHaveText('41');
  await expect(lifeOf(page, 0)).toHaveText('40');

  // It's not p2's turn yet: no end-turn button on the phone.
  await expect(phone.getByRole('button', { name: 'Zakończ turę' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Następna tura' }).click();
  await expect(phone.getByRole('button', { name: 'Zakończ turę' })).toBeVisible();
  await phone.getByRole('button', { name: 'Zakończ turę' }).click();
  await expect(panel(page, 2)).toHaveClass(/\bactive\b/);
  await expect(phone.getByRole('button', { name: 'Zakończ turę' })).toHaveCount(0);

  // Phone reload keeps the seat.
  await phone.reload();
  await expect(phone.getByTestId('life')).toHaveText('41');

  await phoneCtx.close();
});
