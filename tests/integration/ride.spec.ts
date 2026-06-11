import { test, expect, type Page } from '@playwright/test';
import type { McApi } from '../../src/main';

declare global {
  interface Window {
    __MC__?: McApi;
  }
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__MC__?.ready === true, undefined, { timeout: 30_000 });
  return errors;
}

test('boots without errors and shows the generated title screen', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('#mc-title')).toBeVisible();
  await expect(page.locator('#mc-ride')).toBeVisible();
  // the logo is a runtime-generated canvas, not an image asset
  await expect(page.locator('canvas#mc-logo')).toBeVisible();
  expect(errors).toEqual([]);
});

test('clicking RIDE starts the simulation and moves the train', async ({ page }) => {
  const errors = await boot(page);
  await page.click('#mc-ride');
  await expect(page.locator('#mc-title')).not.toBeVisible();
  await expect(page.locator('#mc-hud')).toBeVisible();

  await page.waitForFunction(() => window.__MC__!.state().v > 0.5, undefined, { timeout: 15_000 });
  const s1 = await page.evaluate(() => window.__MC__!.state().s);
  await page.waitForTimeout(1500);
  const s2 = await page.evaluate(() => window.__MC__!.state().s);
  expect(s2).not.toBe(s1);

  const speedText = await page.locator('#mc-speed').textContent();
  expect(parseFloat(speedText!)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('WebGL canvas paints a moving scene (not a blank frame)', async ({ page }) => {
  await boot(page);
  await page.click('#mc-ride');
  await page.waitForTimeout(1000);
  const canvas = page.locator('#app canvas').first();
  const shot1 = await canvas.screenshot();
  // a real rendered voxel scene compresses far larger than a flat frame
  expect(shot1.byteLength).toBeGreaterThan(20_000);
  await page.waitForTimeout(1200);
  const shot2 = await canvas.screenshot();
  expect(shot1.equals(shot2)).toBe(false);

  // and the motion must be the ride, not just sky animation: the onboard
  // camera's world position has to travel with the train
  const cam1 = await page.evaluate(() => window.__MC__!.state().cam);
  await page.evaluate(() => window.__MC__!.warp(10));
  await page.waitForTimeout(150);
  const cam2 = await page.evaluate(() => window.__MC__!.state().cam);
  const dist = Math.hypot(cam2[0] - cam1[0], cam2[1] - cam1[1], cam2[2] - cam1[2]);
  expect(dist).toBeGreaterThan(3);
});

test('a full lap completes with fireworks (deterministic warp)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__MC__!.start());
  // warp the fixed-timestep sim in chunks until the lap wraps
  const result = await page.evaluate(() => {
    const mc = window.__MC__!;
    let warped = 0;
    while (mc.state().lap < 1 && warped < 300) {
      mc.warp(15);
      warped += 15;
    }
    // run past the staggered burst schedule so rockets actually explode
    mc.warp(2);
    return { ...mc.state(), warped };
  });
  expect(result.lap).toBeGreaterThanOrEqual(1);
  expect(result.fireworks).toBeGreaterThanOrEqual(1);
  // particle-level proof: live firework particles exist in the pool
  expect(result.fireworkParticles).toBeGreaterThan(0);
  expect(result.warped).toBeLessThan(300);
});

test('camera modes cycle with C and update the HUD', async ({ page }) => {
  await boot(page);
  await page.click('#mc-ride');
  const first = await page.evaluate(() => window.__MC__!.state().camera);
  expect(first).toBe('onboard');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#mc-cam')).toHaveText('chase');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#mc-cam')).toHaveText('orbit');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#mc-cam')).toHaveText('onboard');
});

test('mute toggles with M', async ({ page }) => {
  await boot(page);
  await page.click('#mc-ride');
  expect(await page.evaluate(() => window.__MC__!.state().muted)).toBe(false);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#mc-mute')).toHaveText('off');
  expect(await page.evaluate(() => window.__MC__!.state().muted)).toBe(true);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#mc-mute')).toHaveText('on');
});

test('rides cleanly for several seconds without console errors', async ({ page }) => {
  const errors = await boot(page);
  await page.click('#mc-ride');
  await page.waitForTimeout(5000);
  expect(errors).toEqual([]);
  // still riding, still simulating
  const state = await page.evaluate(() => window.__MC__!.state());
  expect(state.mode).toBe('riding');
  expect(state.v).toBeGreaterThan(0);
});
