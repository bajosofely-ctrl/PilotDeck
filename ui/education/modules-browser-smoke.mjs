import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const host = process.env.EDUCATION_TEST_HOST || 'http://localhost:3001';
const output = fileURLToPath(new URL('../../logs/education-additions/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce',
  storageState: process.env.EDUCATION_TEST_STORAGE_STATE,
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
const badResources = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (/localhost:301[12]\//.test(response.url()) && response.status() >= 400) badResources.push(response.url());
});
const shot = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
async function fits(frame) {
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, frame.url());
}
async function enter(name, id) {
  await page.goto(`${host}/education`);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page).toHaveURL(`${host}/education/${id}`);
  await expect(page.locator('iframe')).toBeVisible();
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  assert.ok(frame);
  await frame.waitForLoadState('domcontentloaded');
  return frame;
}
try {
  let frame = await enter('AI 通识与实验', 'ai-literacy');
  const courseOrigin = new URL(frame.url()).origin;
  await expect(frame.locator('.edition-cta')).toHaveCount(5);
  await fits(frame);
  await shot('courses-desktop');
  const editions = { 'standard-5': 5, 'standard-15': 15, 'lab-10': 10, 'app-inventor-10': 10, 'web-ai-12': 12 };
  for (const [edition, count] of Object.entries(editions)) {
    await frame.goto(`${courseOrigin}/${edition}/index.html`);
    await expect(frame.locator('.lesson-card')).toHaveCount(count);
    await expect(frame.locator('.lesson-card').first().locator('.lesson-status')).toBeHidden();
    for (let i = 1; i <= count; i++) {
      const response = await context.request.get(`${courseOrigin}/${edition}/lessons/lesson${i}.html`);
      assert.equal(response.status(), 200);
    }
    await frame.locator('.lesson-card').first().locator('a[href*="lessons/lesson1"]').click();
    const questions = frame.locator('.quiz-question');
    await expect(questions.first()).toBeVisible();
    await frame.waitForLoadState('load');
    for (let i = 0; i < await questions.count(); i++) {
      const question = questions.nth(i);
      const answer = await question.getAttribute('data-correct');
      const option = question.locator(`.quiz-option[data-value="${answer}"]`);
      await option.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await option.click();
      await expect(option).toHaveClass(/correct/);
    }
    await expect(frame.locator('.quiz-result')).toBeVisible();
    await frame.goto(`${courseOrigin}/${edition}/index.html`);
    await expect(frame.locator('.lesson-card').first().locator('.lesson-status')).toBeVisible();
    await page.reload();
    await expect(page.locator('iframe')).toBeVisible();
    frame = await (await page.locator('iframe').elementHandle()).contentFrame();
    await frame.goto(`${courseOrigin}/${edition}/index.html`);
    await expect(frame.locator('.lesson-card').first().locator('.lesson-status')).toBeVisible();
  }
  await frame.goto(`${courseOrigin}/standard-5/lessons/lesson1.html`);
  await frame.locator('.lang-toggle').click();
  await expect(frame.locator('html')).toHaveAttribute('data-lang', 'en');
  await frame.locator('.lang-toggle').click();
  await frame.locator('.timeline-card').first().click();
  await expect(frame.locator('.timeline-detail').first()).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('ai-class-progress:standard-5')), null);
  await shot('lesson-desktop');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(page); await fits(frame);
    await shot(`lesson-${width}`);
    await frame.goto(courseOrigin);
    await fits(frame);
    await shot(`courses-${width}`);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  frame = await enter('AI 学习教练', 'study-coach');
  const coachOrigin = new URL(frame.url()).origin;
  assert.notEqual(coachOrigin, courseOrigin);
  await expect(frame.locator('#connection')).toHaveText('未配置模型');
  await frame.locator('#question').fill('我把 1/2 + 1/3 算成了 2/5。');
  await frame.locator('#send').click();
  await expect(frame.locator('#settings')).toBeVisible();
  await frame.locator('#api-key').fill('test-only-not-a-real-key');
  await frame.getByRole('button', { name: '应用配置' }).click();
  let requestBody;
  await page.route(`${coachOrigin}/api/coach/chat`, route => {
    requestBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ answer: '这是一条自动化测试回复：我们先看看两个分母是否相同，再想想怎样通分。' }),
    });
  });
  await frame.locator('#send').click();
  await expect(frame.locator('.message.assistant')).toContainText('通分');
  assert.equal(requestBody.mode, 'math');
  assert.equal(requestBody.grade, 4);
  const localData = await frame.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!localData.includes('test-only-not-a-real-key'));
  assert.equal(await page.evaluate(() => localStorage.getItem('pilotdeck.education.coach.v1')), null);
  assert.equal(await frame.evaluate(() => localStorage.getItem('ai-class-progress:standard-5')), null);
  await shot('coach-desktop');
  const downloadEvent = page.waitForEvent('download');
  await frame.locator('#export').click();
  const download = await downloadEvent;
  await download.saveAs(`${output}/study-record.md`);
  await frame.getByRole('button', { name: '阅读理解', exact: true }).click();
  await expect(frame.locator('.message')).toHaveCount(0);
  await frame.getByRole('button', { name: '数学引导', exact: true }).click();
  await expect(frame.locator('.message')).toHaveCount(2);
  await frame.locator('#grade').selectOption('5');
  await expect(frame.locator('.message')).toHaveCount(0);
  await frame.locator('#grade').selectOption('4');
  await expect(frame.locator('.message')).toHaveCount(2);
  const skillDownloadEvent = page.waitForEvent('download');
  await frame.locator('#skill-download').click();
  assert.match((await skillDownloadEvent).suggestedFilename(), /math-tutor\.md$/);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(page); await fits(frame); await shot(`coach-${width}`);
    await frame.locator('#settings-open').click();
    await expect(frame.locator('#settings')).toBeVisible();
    await fits(frame); await shot(`coach-settings-${width}`);
    await frame.locator('#settings-close').click();
  }
  await page.getByRole('button', { name: '返回学习', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await fits(page); await shot('modules-mobile');
  await page.getByRole('button', { name: 'AI 学习教练', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('#connection')).toHaveText('未配置模型');
  await expect(page.frameLocator('iframe').locator('.message')).toHaveCount(2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '返回学习', exact: true }).click();
  await shot('modules-desktop');
  assert.deepEqual(errors, []);
  assert.deepEqual(badResources, []);
  console.log(JSON.stringify({
    status: 'passed', lessons: 52, editions: 5, errors, badResources,
    coach: 'UI tested with a mocked provider; no paid API call or real model answer verified',
    screenshots: output,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ errors, badResources }, null, 2));
  await shot('failure');
  throw error;
} finally {
  await context.close();
  await browser.close();
}
