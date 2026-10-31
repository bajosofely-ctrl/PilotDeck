// @vitest-environment node
import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createEducationApp } from './server.js';

let browser;
const cleanups = [];
beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); }, 20000);
afterAll(async () => { await browser?.close(); });
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const modules = [
  { id: 'study-coach', open: '#settings-open', dialog: '#settings', prompt: '#question', send: '#send', answer: '#messages' },
  { id: 'ai-classroom', open: '#settings', dialog: '#settings-dialog', prompt: '#prompt', send: '#run', answer: '#answer' },
];
const catalog = {
  items: [
    { id: 'default-model', name: '默认模型', protocol: 'openai', inputPriceMicros: 1000000, outputPriceMicros: 2000000 },
    { id: 'selected-model', name: '另一个模型', protocol: 'anthropic', inputPriceMicros: 3000000, outputPriceMicros: 4000000 },
  ],
  defaultModelId: 'default-model',
};
async function setup(module, { managed = true, unavailable = false, framed = false } = {}) {
  let origin;
  let parentOrigin;
  if (framed) {
    const parent = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><body style="margin:0"><iframe title="Learning" src="${origin}/" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups" style="width:100%;height:100vh;border:0"></iframe></body></html>`);
    });
    parent.listen(0, '127.0.0.1');
    await once(parent, 'listening');
    cleanups.push(() => new Promise(resolve => { parent.close(resolve); parent.closeAllConnections(); }));
    parentOrigin = `http://127.0.0.1:${parent.address().port}`;
  }
  const request = vi.fn(async url => {
    if (url.endsWith('/models')) return unavailable ? new Response('private service error', { status: 503 }) : Response.json(catalog);
    return Response.json(managed ? { answer: '这是经过代理的练习回复。' } : { choices: [{ message: { content: '本地模型回复。' } }] });
  });
  const app = createEducationApp({
    siteRoot: fileURLToPath(new URL(`./${module.id}/`, import.meta.url)),
    moduleId: module.id, coach: module.id === 'study-coach', request,
    frameAncestors: parentOrigin ? [parentOrigin] : [],
    env: managed ? { PILOTDECK_MANAGED_BRIDGE: 'http://127.0.0.1:39001', PILOTDECK_MANAGED_LOCAL_KEY: 'ui-test-local-key' } : {},
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  cleanups.push(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(parentOrigin || origin);
  return { page: framed ? page.frameLocator('iframe') : page, request, errors, recover() { unavailable = false; } };
}

it.each(modules)('$id uses permitted models and prices without BYOK inputs', async module => {
  const { page, request, errors } = await setup(module, { framed: true });
  await browserExpect(page.locator('#managed-status')).toHaveText('账户托管模型');
  await page.locator(module.open).click();
  await browserExpect(page.locator('#api-key')).toHaveCount(0);
  await browserExpect(page.locator('#provider')).toHaveCount(0);
  await browserExpect(page.locator('#endpoint')).toHaveCount(0);
  await browserExpect(page.locator('#managed-model')).toHaveValue('default-model');
  await browserExpect(page.locator('#managed-price')).toContainText('输入 1 元 / 百万 Token');
  await page.locator('#managed-model').selectOption('selected-model');
  await browserExpect(page.locator('#managed-price')).toContainText('输出 4 元 / 百万 Token');
  expect(await page.locator('html').evaluate(el => el.scrollWidth <= el.ownerDocument.defaultView.innerWidth)).toBe(true);
  await page.locator('#settings-apply').click();
  await browserExpect(page.locator(module.dialog)).not.toBeVisible();
  await page.locator(module.prompt).fill('请解释一下分数。');
  await page.locator(module.send).click();
  await browserExpect(page.locator(module.answer)).toContainText('这是经过代理的练习回复。');
  const completion = request.mock.calls.find(([url]) => url.endsWith('/complete'));
  expect(JSON.parse(completion[1].body).modelId).toBe('selected-model');
  expect(await page.locator('body').innerText()).not.toContain('ui-test-local-key');
  expect(errors).toEqual([]);
}, 20000);

it.each(modules)('$id preserves local credential settings and requests', async module => {
  const { page, request, errors } = await setup(module, { managed: false });
  await browserExpect(page.locator('#managed-status')).toContainText('本地模式');
  await page.locator(module.open).click();
  await browserExpect(page.locator('#managed-settings')).not.toBeVisible();
  await browserExpect(page.locator('#api-key')).toBeVisible();
  await page.locator('#provider').selectOption('deepseek');
  await page.locator('#model').fill('deepseek-chat');
  await page.locator('#api-key').fill('independent-test-key');
  await page.locator('#settings-apply').click();
  await page.locator(module.prompt).fill('解释一下分数。');
  await page.locator(module.send).click();
  await browserExpect(page.locator(module.answer)).toContainText('本地模型回复。');
  expect(request.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
  expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer independent-test-key');
  expect(errors).toEqual([]);
}, 20000);

it.each(modules)('$id blocks calls on config failure and recovers without a BYOK fallback', async module => {
  const { page, request, recover, errors } = await setup(module, { unavailable: true });
  await browserExpect(page.locator('#managed-status')).toHaveText('无法读取模型设置，请重试。');
  await page.locator(module.prompt).fill('解释一下分数。');
  await page.locator(module.send).click();
  await browserExpect(page.locator(module.dialog)).toBeVisible();
  await browserExpect(page.locator('#local-settings')).not.toBeVisible();
  await browserExpect(page.locator('#settings-apply')).toBeDisabled();
  expect(request.mock.calls.every(([url]) => url.endsWith('/models'))).toBe(true);
  recover();
  await page.locator('#managed-refresh').click();
  await browserExpect(page.locator('#managed-status')).toHaveText('账户托管模型');
  await browserExpect(page.locator('#api-key')).toHaveCount(0);
  await browserExpect(page.locator('#settings-apply')).toBeEnabled();
  expect(errors).toEqual([]);
}, 20000);
