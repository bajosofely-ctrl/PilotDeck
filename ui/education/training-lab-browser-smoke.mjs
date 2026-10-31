import assert from 'node:assert/strict';
import express from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import JSZip from 'jszip';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, '../../logs/training-lab');
await mkdir(output, { recursive: true });
const listen = app => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const host = express();
let childOrigin;
host.get('/', (_req, res) => res.send(`<!doctype html><html><body style="margin:0"><iframe title="AI 训练实验室" src="${childOrigin}/" allow="camera; microphone; autoplay" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups" style="border:0;width:100%;height:100vh"></iframe></body></html>`));
const parent = await listen(host);
const parentOrigin = `http://127.0.0.1:${parent.address().port}`;
const csp = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "media-src 'self' blob: data:", "connect-src 'self' blob:",
  "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'",
  "form-action 'self'", `frame-ancestors ${parentOrigin}`,
].join('; ');
const app = express();
app.use((_req, res, next) => { res.set('Content-Security-Policy', csp); next(); });
app.use(express.static(path.join(here, 'training-lab')));
const child = await listen(app);
childOrigin = `http://127.0.0.1:${child.address().port}`;
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce',
  permissions: ['camera', 'microphone'], acceptDownloads: true,
});
const errors = [], external = [], badResponses = [], consoleErrors = [];
const requests = new Set();
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
  external.push(url.href);
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('response', response => {
  requests.add(response.url());
  if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
});
page.on('dialog', dialog => dialog.accept());
await page.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', event => window.__cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`));
});
const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
let frame;
const report = {
  sourceCommit: '4a9b696f03cd5fd6f346424a56fb51ba9cfe86cf',
  browser: browser.version(), timestamp: new Date().toISOString(),
  checks: [], errors, external, badResponses, consoleErrors,
};
try {
  await page.goto(parentOrigin);
  frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  await expect(frame.getByRole('heading', { name: 'AI 训练实验室', exact: true })).toBeVisible();
  await screenshot('home-desktop');
  await frame.locator('a[href^="#/image/general"]').click();
  await expect(frame.getByTestId('train-button')).toHaveAttribute('data-model-ready', 'true', { timeout: 120000 });
  await expect(frame.getByTestId('train-button')).toBeDisabled();
  report.checks.push('Chinese home; image model loads under CSP with external network blocked');
  const fixtures = await frame.evaluate(() => {
    const images = [];
    for (const color of ['red', 'blue']) {
      for (let i = 0; i < 8; i++) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 224;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 224, 224);
        ctx.fillStyle = color;
        if (color === 'red') ctx.fillRect(20 + i, 20, 170, 170);
        else { ctx.beginPath(); ctx.arc(112, 112, 70 + i, 0, 2 * Math.PI); ctx.fill(); }
        images.push({ name: `${color}-${i}.png`, mimeType: 'image/png', data: canvas.toDataURL().split(',')[1] });
      }
    }
    return images;
  });
  const files = fixtures.map(({ data, ...file }) => ({ ...file, buffer: Buffer.from(data, 'base64') }));
  await frame.locator('#widget-class-0 input[type=file]').setInputFiles(files.slice(0, 8));
  await frame.locator('#widget-class-1 input[type=file]').setInputFiles(files.slice(8));
  await expect(frame.getByTestId('train-button')).toBeEnabled();
  await screenshot('samples');
  await frame.getByTestId('train-button').click();
  await expect(frame.getByTestId('alert-complete')).toBeVisible({ timeout: 180000 });
  await expect(frame.getByTestId('next-step')).toBeEnabled();
  report.checks.push('Real TensorFlow.js training: 16 uploaded images, two classes, default 50 epochs');
  await frame.getByRole('tab', { name: '文件', exact: true }).click();
  const probabilities = [];
  for (const index of [0, 8]) {
    await frame.locator('#input-panel-1 input[type=file]').setInputFiles(files[index]);
    await expect(frame.getByTestId('prediction-0')).toContainText('%', { timeout: 60000 });
    // Wait for the uploaded canvas and model result to update together.
    await expect.poll(async () => {
      const text = await frame.getByTestId(`prediction-${index === 0 ? 0 : 1}`).innerText();
      return Number(text.match(/([\d.]+)\s*%/)?.[1] || 0);
    }, { timeout: 60000 }).toBeGreaterThan(50);
    probabilities.push(await frame.locator('[data-testid^="prediction-"]').allTextContents());
  }
  report.predictions = probabilities;
  report.checks.push('Distinct uploaded test images produce matching learned classes, each above 50%');
  await screenshot('trained-prediction');
  await frame.getByRole('button', { name: '模型统计', exact: true }).click();
  await expect(frame.locator('canvas').first()).toBeVisible();
  await screenshot('statistics');
  await frame.goto(`${childOrigin}/#/image/general`);
  await frame.getByTestId('save-project').click();
  await frame.getByRole('textbox', { name: '名称', exact: true }).fill('training-lab-smoke');
  const downloadPromise = page.waitForEvent('download');
  await frame.getByTestId('save-save').click();
  const download = await downloadPromise;
  const zipPath = path.join(output, 'training-lab-smoke.zip');
  await download.saveAs(zipPath);
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  report.zipEntries = Object.keys(zip.files);
  assert.ok(report.zipEntries.some(name => name.endsWith('.bin')), 'Export includes trained weights');
  assert.ok(report.zipEntries.some(name => name.endsWith('model.json')), 'Export includes a model');
  report.checks.push('Local ZIP export includes model topology and actual trained weights');
  await frame.goto(`${childOrigin}/?smoke=reopen#/image/general`);
  await frame.getByTestId('open-project').click();
  await frame.locator('#openfile').setInputFiles(zipPath);
  await expect(frame.getByRole('tab', { name: '文件', exact: true })).toBeEnabled({ timeout: 120000 });
  await frame.getByRole('tab', { name: '文件', exact: true }).click();
  await frame.locator('#input-panel-1 input[type=file]').setInputFiles(files[0]);
  await expect(frame.getByTestId('prediction-0')).toContainText('%', { timeout: 60000 });
  report.checks.push('Saved ZIP reopens and predicts after a full page reload');
  await frame.goto(`${childOrigin}/?smoke=camera#/image/general`);
  await expect(frame.getByTestId('train-button')).toHaveAttribute('data-model-ready', 'true', { timeout: 120000 });
  await frame.locator('#widget-class-0').getByRole('button', { name: '摄像头', exact: true }).click();
  await expect.poll(() => frame.getByTestId('webcamwindow').locator('canvas').evaluateAll(canvases => canvases.some(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 !== 3 && value > 0 && value !== pixels[index % 4]);
  })), { timeout: 30000 }).toBe(true);
  const capture = frame.getByRole('button', { name: '按住采集', exact: true });
  await capture.hover();
  await page.mouse.down();
  await expect.poll(async () => Number((await frame.locator('#widget-class-0').innerText()).match(/(\d+) 个图像样本/)?.[1] || 0)).toBeGreaterThan(0);
  await page.mouse.up();
  await screenshot('camera');
  report.checks.push('Camera stream works inside cross-origin sandboxed iframe using Chrome fake device');
  for (const variant of ['pose', 'hand', 'speech']) {
    await frame.goto(`${childOrigin}/#/${variant}/general`);
    await expect(frame.getByTestId('train-button')).toHaveAttribute('data-model-ready', 'true', { timeout: 120000 });
    if (variant !== 'speech') {
      const image = path.join(here, 'training-lab', variant === 'pose' ? 'body.jpg' : 'gesture1.jpg');
      await frame.locator('#widget-class-0 input[type=file]').setInputFiles(image);
      await expect.poll(() => frame.locator('#widget-class-0 ol canvas').count(), { timeout: 120000 }).toBeGreaterThan(0);
    }
    await screenshot(`${variant}-ready`);
    report.checks.push(`${variant} model initialization${variant === 'speech' ? '' : ' and image feature extraction'} with bundled assets under CSP`);
  }
  await frame.locator('#widget-class-0').getByRole('button', { name: '麦克风', exact: true }).click();
  await frame.getByRole('button', { name: '录制', exact: true }).click();
  await expect.poll(() => frame.locator('#widget-class-0 ol canvas').count(), { timeout: 30000 }).toBeGreaterThan(0);
  await frame.getByRole('button', { name: '停止', exact: true }).click();
  await screenshot('microphone');
  report.checks.push('Microphone records real audio samples inside sandboxed iframe using Chrome fake device');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await frame.goto(`${childOrigin}/#/home`);
    await expect(frame.getByRole('heading', { name: 'AI 训练实验室', exact: true })).toBeVisible();
    assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await screenshot(`home-${width}`);
    await frame.goto(`${childOrigin}/#/image/general`);
    await expect(frame.getByTestId('train-button')).toBeVisible();
    await expect(frame.getByTestId('train-button')).toHaveAttribute('data-model-ready', 'true', { timeout: 120000 });
    assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await screenshot(`workspace-${width}`);
  }
  report.checks.push('320px and 390px home/workspace fit viewport; workspace retains upstream internal scrolling');
  report.cspViolations = await frame.evaluate(() => window.__cspViolations);
  assert.deepEqual(report.cspViolations, []);
  assert.deepEqual(external, [], 'No external network requests');
  assert.deepEqual(badResponses, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  report.requests = [...requests].sort();
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  report.cspViolations = await frame?.evaluate(() => window.__cspViolations).catch(() => []);
  await screenshot('failure').catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  await new Promise(resolve => child.close(resolve));
  await new Promise(resolve => parent.close(resolve));
}
