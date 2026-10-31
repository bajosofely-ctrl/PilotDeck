import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalGateway } from "../../src/cli/createLocalGateway.js";
import type { GatewayEvent } from "../../src/gateway/protocol/types.js";

async function fixture(t: test.TestContext, managed = true, chatDisabled = false) {
  const home = await mkdtemp(join(tmpdir(), "pilotdeck-managed-automation-"));
  const calls: { path: string; body: Record<string, unknown>; authorization: string | undefined }[] = [];
  let permitted = true;
  let catalogReads = 0;
  let defaultModel = "auto-model";
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/api/managed/automation/models") {
      catalogReads++;
      assert.equal(req.headers.authorization, "Bearer fixture-local-secret");
      res.setHeader("Content-Type", "application/json");
      if (!permitted) { res.writeHead(403); res.end(JSON.stringify({ error: "Automation disabled" })); return; }
      res.end(JSON.stringify({
        items: [defaultModel, "allowed-second"].map((id) => ({
          id, name: id, protocol: "openai", capabilities: ["text", "tools"],
          maxInputTokens: 8192, maxOutputTokens: 512,
        })),
        defaultModelId: defaultModel,
      }));
      return;
    }
    calls.push({ path: req.url || "", body, authorization: req.headers.authorization });
    if (req.url?.includes("/managed/unavailable/")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Chat disabled" } })); return;
    }
    if (!permitted && req.url?.includes("/relay/automation/")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Automation disabled" })); return;
    }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "Done" }, finish_reason: null }] })}\n\n`
        + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } })}\n\n`
        + "data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: '{"title":"Fixture title"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1 } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const provider = chatDisabled ? "managed__disabled" : "managed_chat-model";
  const chatModel = chatDisabled ? "disabled" : "chat-model";
  await mkdir(join(home, "skills"));
  await writeFile(join(home, "pilotdeck.yaml"), `
schemaVersion: 1
agent:
  model: ${provider}/${chatModel}
model:
  providers:
    ${provider}:
      protocol: openai
      url: http://127.0.0.1:${port}/api/managed/${chatDisabled ? "unavailable" : "relay/chat/chat-model"}
      apiKey: fixture-local-secret
      retry: { requestMaxRetries: 0, streamMaxRetries: 0 }
      models:
        ${chatModel}:
          capabilities: { maxContextTokens: 8192, maxOutputTokens: 512 }
extension:
  builtinPluginsEnabled: { windows-skills: false, browser-use: false, funasr: false }
memory: { enabled: false }
telemetry: { enabled: false }
router: { enabled: false }
`);
  const local = createLocalGateway({
    pilotHome: home, projectRoot: home, builtinSkillsRoot: join(home, "skills"),
    env: {
      PILOT_HOME: home, PILOTDECK_CONFIG_PATH: join(home, "pilotdeck.yaml"),
      ...(managed ? {
        PILOTDECK_MANAGED_URL: "https://cloud.example.test",
        PILOTDECK_MANAGED_TOKEN: "fixture-cloud-token-never-forward",
        PILOTDECK_MANAGED_LOCAL_KEY: "fixture-local-secret",
        SERVER_PORT: String(port),
      } : {}),
    },
  });
  t.after(async () => {
    local.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
  return {
    local, calls, home,
    deny() { permitted = false; },
    changeDefault() { defaultModel = "new-auto-model"; },
    reads: () => catalogReads,
    async submit(sessionKey: string) {
      const events: GatewayEvent[] = [];
      for await (const event of local.gateway.submitTurn({
        projectKey: home, sessionKey, channelKey: "web", message: "Say done",
        mode: "bypassPermissions", canPrompt: false,
      })) events.push(event);
      return events;
    },
  };
}

for (const sessionKey of ["cron:fixture", "always-on/execute:fixture"]) {
  test(`managed ${sessionKey} denies before model calls when only chat is allowed`, async (t) => {
    const f = await fixture(t);
    f.deny();
    let rejected = false;
    try {
      const events = await f.submit(sessionKey);
      rejected = events.some((event) => event.type === "error" ||
        (event.type === "turn_completed" && event.finishReason !== "completed"));
    } catch { rejected = true; }
    assert.equal(rejected, true);
    assert.equal(f.calls.length, 0, "denied automation must not make any chat or automation model call");
    assert.ok(f.reads() > 0);
  });
}

test("managed automation uses its default and fresh catalog while parallel chat stays unchanged", async (t) => {
  const f = await fixture(t);
  const shared = f.local.registry.resolve(f.home);
  const originalModel = shared.model;
  const originalRouter = shared.router;
  const originalConfig = JSON.stringify(shared.snapshot.config);
  const [chatEvents, autoEvents] = await Promise.all([f.submit("web:fixture"), f.submit("cron:fixture")]);
  for (const events of [chatEvents, autoEvents]) {
    assert.ok(events.some((event) => event.type === "turn_completed" && event.finishReason === "completed"), JSON.stringify(events));
  }
  assert.ok(f.calls.some((call) => call.path.includes("/relay/chat/chat-model/") && call.body.stream));
  assert.ok(f.calls.some((call) => call.path.includes("/relay/automation/auto-model/") && call.body.stream));
  assert.equal(f.local.registry.resolve(f.home).model, originalModel);
  assert.equal(f.local.registry.resolve(f.home).router, originalRouter);
  assert.equal(JSON.stringify(shared.snapshot.config), originalConfig);
  assert.ok(f.calls.every((call) => !JSON.stringify(call).includes("fixture-cloud-token")));
  f.changeDefault();
  await f.submit("cron:fixture");
  assert.ok(f.calls.some((call) => call.path.includes("/relay/automation/new-auto-model/")));
  f.deny();
  const before = f.calls.length;
  await f.submit("cron:fixture");
  assert.equal(f.calls.length, before, "revocation on an existing session must fail closed without chat fallback");
});

test("unmanaged cron retains its configured local provider without catalog requests", async (t) => {
  const f = await fixture(t, false);
  const events = await f.submit("cron:fixture-local");
  assert.ok(events.some((event) => event.type === "turn_completed" && event.finishReason === "completed"));
  assert.equal(f.reads(), 0);
  assert.ok(f.calls.some((call) => call.path.includes("/relay/chat/chat-model/")));
});

test("automation-only accounts execute scheduled tasks with the disabled chat startup transport", async t => {
  const f = await fixture(t, true, true);
  const events = await f.submit("cron:automation-only");
  assert.ok(events.some(event => event.type === "turn_completed" && event.finishReason === "completed"), JSON.stringify(events));
  assert.ok(f.calls.length > 0);
  assert.ok(f.calls.every(call => call.path.includes("/relay/automation/")));
});
