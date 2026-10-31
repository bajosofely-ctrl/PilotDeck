import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const host = process.env.EDUCATION_TEST_HOST || 'http://localhost:3001';
const output = fileURLToPath(new URL('../../logs/ai-classroom/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, locale: 'zh-CN',
    storageState: process.env.EDUCATION_TEST_STORAGE_STATE,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  const external = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    let frameUrl;
    try { frameUrl = request.frame().url(); } catch { return; }
    if (!frameUrl.includes(':3015/')) return;
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname)) external.push(request.url());
  });
  let fail = false;
  await page.route('**/api/classroom/complete', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: fail ? 502 : 200, contentType: 'application/json',
      body: JSON.stringify(fail ? { error: '模型鉴权失败，请检查 API Key 与权限。' }
        : { answer: '<img src=x onerror="window.injected=true"> 测试回复：请核对。' }),
    });
  });
  await page.goto(`${host}/education`);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'AI 使用小课堂', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', 'http://localhost:3015/');
  let frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  await expect(frame.locator('#lessons a')).toHaveCount(7);
  await expect(frame.locator('#content-area h1')).toHaveText('把问题说完整');
  await expect(frame.locator('#progress')).toHaveText('已学 0 / 7');
  await page.screenshot({ path: `${output}/desktop-entry.png`, fullPage: true });
  await frame.locator('#prompt').fill('请用两个生活例子解释分数。');
  await frame.locator('#run').click();
  await expect(frame.locator('#settings-dialog')).toBeVisible();
  assert.equal(requests.length, 0);
  await frame.locator('#api-key').fill('fixture-not-real-key');
  await frame.getByRole('button', { name: '应用设置', exact: true }).click();
  await frame.locator('#run').click();
  await expect(frame.locator('#answer')).toContainText('测试回复');
  await expect(frame.locator('#answer img')).toHaveCount(0);
  assert.equal(await frame.evaluate(() => window.injected), undefined);
  assert.equal(requests[0].prompt, '请用两个生活例子解释分数。');
  assert.equal(await frame.evaluate(() => JSON.stringify(localStorage).includes('fixture-not-real-key')), false);
  await frame.locator('#compare').click();
  await expect(frame.locator('#comparison')).toContainText('B · 改进提问的回复');
  assert.equal(requests.length, 3);
  const download = page.waitForEvent('download');
  await frame.locator('#export').click();
  await (await download).saveAs(`${output}/practice.md`);
  fail = true;
  await frame.locator('#run').click();
  await expect(frame.locator('#answer')).toContainText('鉴权失败');
  fail = false;
  await frame.locator('#run').click();
  await expect(frame.locator('#answer')).toContainText('测试回复');
  await frame.locator('#complete').click();
  await expect(frame.locator('#progress')).toHaveText('已学 1 / 7');
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });

  for (let index = 2; index <= 7; index++) {
    await frame.locator('#next').click();
    await expect(frame.locator('.lesson-meta')).toContainText(`第 ${index} 课`);
    await expect(frame.locator('#progress')).toHaveText('已学 1 / 7');
  }
  await expect(frame.locator('#next')).toBeDisabled();
  await frame.locator('a[href="#lesson-1"]').click();
  await expect(frame.locator('#prompt')).toHaveValue('请用两个生活例子解释分数。');
  await page.reload();
  await expect(page.locator('iframe')).toBeVisible();
  frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  await expect(frame.locator('#progress')).toHaveText('已学 1 / 7');
  await expect(frame.locator('#prompt')).toHaveValue('请用两个生活例子解释分数。');
  await frame.locator('#run').click();
  await expect(frame.locator('#settings-dialog')).toBeVisible();
  await expect(frame.locator('#api-key')).toHaveValue('');
  await frame.locator('#close-settings').click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(frame.locator('#content-area h1')).toBeVisible();
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await frame.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/mobile-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '返回学习', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'AI 使用小课堂', exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: 7 lessons, iframe, drafts/progress, independent credentials, comparison, export, retry, safe answer rendering, mobile, no external resources.');
} finally { await browser.close(); }
