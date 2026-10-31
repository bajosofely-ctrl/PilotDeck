import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const host = process.env.EDUCATION_TEST_HOST || 'http://localhost:3001';
const topics = JSON.parse(await readFile(new URL('./site/data/topics.json', import.meta.url), 'utf8'));
const subjectPrefixes = { math: 'cnm_', chinese: 'cnc_', english: 'cne_', physics: 'cnp_' };
const output = fileURLToPath(new URL('../../logs/education-smoke/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const storageState = process.env.EDUCATION_TEST_STORAGE_STATE;
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', storageState });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const violations = [];
const errors = [];
let educationOrigin;
page.on('request', request => {
  let frameUrl;
  try { frameUrl = request.frame().url(); } catch { return; }
  // The host workbench legitimately uses its own APIs. Only child requests
  // must remain independent of PilotDeck's data and external services.
  if (!educationOrigin || !frameUrl.startsWith(`${educationOrigin}/`)) return;
  const url = new URL(request.url());
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
      (url.origin === host && url.pathname.startsWith('/api/'))) {
    violations.push(request.url());
  }
});
page.on('pageerror', error => {
  if (page.url().startsWith(`${host}/education`)) errors.push(error.message);
});
page.on('console', message => {
  if (page.url().startsWith(`${host}/education`) && message.type() === 'error') errors.push(message.text());
});
async function screenshot(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
async function fits(target) {
  assert.equal(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
}
try {
  await page.goto(`${host}/p/general`);
  const educationButton = page.getByRole('button', { name: /^(学习|Learning)$/ });
  await expect(educationButton).toBeVisible();
  await page.evaluate(() => { window.__educationNavigationMarker = 'same-document'; });
  await educationButton.click();
  await expect(page).toHaveURL(`${host}/education`);
  await expect(educationButton).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await page.evaluate(() => window.__educationNavigationMarker), 'same-document');
  await expect(page.locator('[data-sidebar-v2-root]')).toBeVisible();
  const moduleButton = page.getByRole('button', { name: '中小学知识图谱与学习诊断', exact: true });
  await expect(moduleButton).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await screenshot('hub-desktop');
  await moduleButton.click();
  await expect(page).toHaveURL(`${host}/education/knowledge`);
  await expect(page.locator('iframe')).toBeVisible();
  await educationButton.click();
  await expect(page).toHaveURL(`${host}/education`);
  await expect(page.locator('iframe')).toHaveCount(0);
  await moduleButton.click();
  const iframe = page.locator('iframe');
  await expect(iframe).toHaveAttribute('src', /http:\/\/localhost:\d+\//);
  educationOrigin = new URL(await iframe.getAttribute('src')).origin;
  const frame = await (await iframe.elementHandle()).contentFrame();
  assert.ok(frame);
  assert.notEqual(educationOrigin, host);
  await expect(frame.locator('#n-topics')).toBeVisible();
  const bounds = await iframe.boundingBox();
  assert.ok(bounds && bounds.width > 700 && bounds.height > 600);
  assert.ok(bounds.y + bounds.height <= 1001);
  await screenshot('education-desktop');
  const subjectCounts = {};
  for (const subject of ['math', 'chinese', 'english', 'physics']) {
    await Promise.all([
      frame.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      frame.locator(`a[data-subject="${subject}"]`).click(),
    ]);
    const expected = topics.filter(topic => topic.id.startsWith(subjectPrefixes[subject])).length;
    await expect(frame.locator('#n-topics')).toHaveText(String(expected));
    const count = Number(await frame.locator('#n-topics').textContent());
    assert.ok(count > 0);
    subjectCounts[subject] = count;
  }
  await frame.goto(`${educationOrigin}/explore/`);
  await frame.locator('#pick-sample').click();
  await expect(frame.locator('#cy')).toBeVisible();
  await frame.waitForFunction(() => [...document.querySelectorAll('#cy canvas')].some(canvas => {
    const context = canvas.getContext('2d');
    return context && context.getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0);
  }));
  await frame.locator('#btn-zoom-in').click();
  await frame.locator('#btn-fit').click();
  await screenshot('graph-desktop');

  await frame.locator('.page-links a[href*="children"]').click();
  // This page initializes and resets its form in deferred scripts.
  await frame.waitForURL(url => url.pathname.endsWith('/children/'), { waitUntil: 'load' });
  await frame.locator('#f-name').fill('集成验证');
  await frame.locator('#f-grade').selectOption({ label: '一年级' });
  await frame.locator('#f-submit').click();
  await expect(frame.locator('.kid-card h3')).toContainText('集成验证');
  await frame.goto(frame.url());
  await expect(frame.locator('.kid-card h3')).toContainText('集成验证');
  assert.equal(await page.evaluate(() => localStorage.getItem('cnmChildren.v1')), null);
  assert.equal(await frame.evaluate(() => {
    try { return parent.localStorage.getItem('cnmChildren.v1'); } catch (error) { return error.name; }
  }), 'SecurityError');

  await frame.goto(`${educationOrigin}/diagnose/?target=cnm_221&limit=2&seed=education-browser`);
  await expect(frame.locator('#btn-skip')).toBeVisible();
  for (let i = 0; i < 3 && !(await frame.locator('#summary').count()); i++) {
    if (await frame.locator('#choices').count()) {
      await frame.locator('#choices button').first().click();
      await frame.locator('#btn-submit').click();
    } else if (await frame.locator('input#ans').count()) {
      await frame.locator('#ans').fill('1');
      await frame.locator('#btn-submit').click();
    } else {
      await frame.locator('#btn-skip').click();
    }
    await expect(frame.locator('#btn-next')).toBeVisible();
    await frame.locator('#btn-next').click();
  }
  await expect(frame.locator('#summary')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await frame.locator('#btn-export').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.json$/);
  await download.saveAs(path.join(output, 'diagnosis.json'));
  await frame.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
      window.__printed = true;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await frame.locator('#btn-print').click();
  assert.equal(await frame.evaluate(() => window.__printed), true);
  assert.ok(await frame.evaluate(() => localStorage.getItem('cnmChildren.records.v1')));
  await screenshot('diagnosis-desktop');

  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
  await fits(frame);
  await screenshot('diagnosis-mobile');
  await frame.goto(`${educationOrigin}/explore/#cnm_221`);
  await expect(frame.locator('#cy')).toBeVisible();
  await fits(frame);
  await screenshot('graph-mobile');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect(educationButton).toBeVisible();
  await expect.poll(async () => {
    const sidebar = await page.locator('[data-sidebar-v2-root]').boundingBox();
    return sidebar && sidebar.x >= 0 && sidebar.x < 20;
  }).toBe(true);
  await screenshot('sidebar-mobile');
  await page.getByRole('button', { name: /^(技能|Skills|技能工具|Skill Tools)$/ }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page).toHaveURL(`${host}/skills`);
  await page.goBack();
  await expect(page.frameLocator('iframe').locator('#n-topics')).toBeVisible();
  await expect(page.getByRole('button', { name: '展开侧栏', exact: true })).toBeVisible();
  await fits(page);
  await screenshot('education-mobile');
  await page.getByRole('button', { name: '返回学习', exact: true }).click();
  await expect(page).toHaveURL(`${host}/education`);
  await expect(moduleButton).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await fits(page);
  await screenshot('hub-mobile');
  await page.setViewportSize({ width: 320, height: 640 });
  await fits(page);
  await expect(moduleButton).toBeVisible();
  await page.reload();
  await expect(moduleButton).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await moduleButton.click();
  await expect(page.frameLocator('iframe').locator('#n-topics')).toBeVisible();
  await fits(page);
  await screenshot('education-small-mobile');
  assert.deepEqual(violations, []);
  assert.deepEqual(errors, []);
  await page.reload();
  await expect(page.frameLocator('iframe').locator('#n-topics')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(educationButton).toBeVisible();

  // Reproduce a refused iframe navigation in Chrome, which does not emit
  // a dependable iframe error event, then recover via explicit retry.
  const recoveryContext = await browser.newContext({ serviceWorkers: 'block', storageState });
  try {
    const recovery = await recoveryContext.newPage();
    await recovery.route(`${educationOrigin}/**`, route => route.abort('connectionrefused'));
    await recovery.route('**/education/runtime.json?check=1', route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ status: 'error', message: '教育服务已停止，请重试。' }),
    }));
    await recovery.goto(`${host}/education/knowledge`);
    await expect(recovery.getByRole('alert')).toContainText('教育服务已停止', { timeout: 20_000 });
    await expect(recovery.locator('iframe')).toHaveCount(0);
    await recovery.unrouteAll();
    await recovery.getByRole('button', { name: '重试', exact: true }).click();
    await expect(recovery.frameLocator('iframe').locator('#n-topics')).toHaveText(
      String(subjectCounts.math), { timeout: 20_000 },
    );
  } finally {
    await recoveryContext.close();
  }
  console.log(JSON.stringify({
    status: 'passed', subjectCounts, violations, errors, recovery: 'passed', screenshots: output,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
