import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason, GenerateContentResponse } from "@google/genai";
import { createManagedAutomationRuntime } from "../../src/model/ManagedAutomationRuntime.js";
import type { CanonicalModelEvent, CanonicalModelRequest, ModelProtocol } from "../../src/model/protocol/canonical.js";
import type { ModelRuntimeOptions } from "../../src/model/streaming/streamModel.js";
import { resolveGoogleEndpoint } from "../../src/model/providers/google/client.js";
import { effectiveInputContextTokens } from "../../src/context/budget/effectiveContext.js";

const env = {
  PILOTDECK_MANAGED_URL: "https://cloud.example.test",
  PILOTDECK_MANAGED_TOKEN: "cloud-secret-must-not-be-used",
  PILOTDECK_MANAGED_LOCAL_KEY: "fixture-local-key",
  SERVER_PORT: "3100",
};
const inherited = { provider: "managed_chat", model: "chat" };
const request: CanonicalModelRequest = {
  ...inherited,
  messages: [{ role: "user", content: [{ type: "text", text: "Fixture" }] }],
  maxOutputTokens: 1000,
  metadata: { sessionId: "web:spoofed", appId: "chat" },
};

function setup(protocol: ModelProtocol = "openai") {
  const calls: { url: string; init?: RequestInit }[] = [];
  let status = 200;
  let empty = false;
  let defaultId = "auto";
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    init?.signal?.throwIfAborted();
    if (String(url).endsWith("/automation/models")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-local-key");
      assert.equal(init?.redirect, "error");
      return Response.json({
        items: empty ? [] : [defaultId, "second"].map((id) => ({
          id, name: id, protocol, capabilities: ["text"], maxInputTokens: 16384, maxOutputTokens: 64,
          // Untrusted catalog addresses and secrets must not affect transport.
          baseUrl: "https://untrusted.example.test", apiKey: "untrusted-key",
        })),
        defaultModelId: defaultId,
      }, { status });
    }
    const body = JSON.parse(String(init?.body));
    if (body.stream) {
      return new Response('data: {"choices":[{"delta":{"content":"streamed"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } });
    }
    return Response.json(protocol === "anthropic"
      ? { role: "assistant", content: [{ type: "text", text: "complete" }], stop_reason: "end_turn" }
      : protocol === "openai-responses"
        ? { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "complete" }] }] }
        : { choices: [{ message: { role: "assistant", content: "complete" }, finish_reason: "stop" }] });
  };
  const options: ModelRuntimeOptions = { fetch: fetchImpl };
  return {
    calls, options,
    deny(code = 403) { status = code; },
    clear() { empty = true; },
    changeDefault() { defaultId = "new-default"; },
    create: () => createManagedAutomationRuntime(env, "cron:fixture", inherited, options),
  };
}

async function collect(stream: AsyncIterable<CanonicalModelEvent>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

test("trusted session binding covers complete and stream despite spoofed chat metadata", async () => {
  const f = setup();
  const scoped = (await f.create())!;
  const unchanged = JSON.stringify(request);
  const response = await scoped.model.complete(request);
  assert.deepEqual(response.content, [{ type: "text", text: "complete" }]);
  const events = await collect(scoped.model.stream(request));
  assert.ok(events.some((event) => event.type === "text_delta" && event.text === "streamed"));
  assert.equal(f.calls.filter((call) => call.url.endsWith("/automation/models")).length, 3);
  const nativeCalls = f.calls.filter((call) => !call.url.endsWith("/models"));
  assert.equal(nativeCalls.length, 2);
  for (const call of nativeCalls) {
    assert.equal(call.url, "http://127.0.0.1:3100/api/managed/relay/automation/auto/v1/chat/completions");
    assert.equal(new Headers(call.init?.headers).get("authorization"), "Bearer fixture-local-key");
    const body = JSON.parse(String(call.init?.body));
    assert.equal(body.model, "auto");
    assert.equal(body.max_tokens ?? body.max_completion_tokens, 64);
    assert.ok(!JSON.stringify(call).includes("cloud-secret"));
    assert.ok(!JSON.stringify(call).includes("untrusted"));
  }
  assert.equal(JSON.stringify(request), unchanged);
});

test("automation retains the authorized input allowance after output reservation", async () => {
  const scoped = (await setup().create())!;
  const caps = scoped.model.getCapabilities("managed_auto", "auto");
  assert.equal(effectiveInputContextTokens(caps.maxContextTokens, caps.maxOutputTokens), 16384);
});

test("allowed explicit model works, removed model denies, default refresh does not change stored config", async () => {
  const f = setup();
  const scoped = (await f.create())!;
  const original = JSON.stringify(scoped.config);
  await scoped.model.complete({ ...request, provider: "managed_second", model: "second" });
  assert.ok(f.calls.at(-1)?.url.includes("/automation/second/"));
  await assert.rejects(scoped.model.complete({ ...request, provider: "managed_removed", model: "removed" }), /not authorized/);
  f.changeDefault();
  await scoped.model.complete(request);
  assert.ok(f.calls.at(-1)?.url.includes("/automation/new-default/"));
  assert.equal(JSON.stringify(scoped.config), original);
});

for (const status of [401, 403, 500]) {
  test(`catalog ${status} denies both completion and streaming with no stale/chat fallback`, async () => {
    const f = setup();
    const scoped = (await f.create())!;
    f.deny(status);
    await assert.rejects(scoped.model.complete(request), new RegExp(`HTTP ${status}`));
    await assert.rejects(collect(scoped.model.stream(request)), new RegExp(`HTTP ${status}`));
    assert.ok(f.calls.every((call) => call.url.endsWith("/automation/models")));
  });
}

test("empty authorized catalog and cancelled requests never reach a model", async () => {
  const f = setup();
  const scoped = (await f.create())!;
  f.clear();
  await assert.rejects(scoped.model.complete(request), /No authorized/);
  const controller = new AbortController();
  controller.abort(new Error("fixture cancellation"));
  await assert.rejects(scoped.model.complete(request, { signal: controller.signal }), /fixture cancellation/);
  assert.ok(f.calls.every((call) => call.url.endsWith("/automation/models")));
});

for (const protocol of ["anthropic", "openai-responses"] as const) {
  test(`${protocol} keeps native completion transport under the automation relay`, async () => {
    const f = setup(protocol);
    const scoped = (await f.create())!;
    const result = await scoped.model.complete(request);
    assert.ok(result.content.some((block) => block.type === "text" && block.text === "complete"));
    assert.equal(f.calls.at(-1)?.url,
      `http://127.0.0.1:3100/api/managed/relay/automation/auto/v1/${protocol === "anthropic" ? "messages" : "responses"}`);
  });
}

test("Google SDK receives automation base URL with v1beta for stream and complete", async () => {
  const f = setup("google");
  const calls: string[] = [];
  const response = new GenerateContentResponse();
  response.candidates = [{ content: { parts: [{ text: "google" }] }, finishReason: FinishReason.STOP }];
  f.options.googleClientFactory = (provider) => {
    assert.equal(provider.apiKey, "fixture-local-key");
    assert.deepEqual(resolveGoogleEndpoint(provider.url), {
      baseUrl: "http://127.0.0.1:3100/api/managed/relay/automation/auto/", apiVersion: "v1beta",
    });
    return { models: {
      async generateContent(params) { calls.push(params.model); return response; },
      async generateContentStream(params) {
        calls.push(params.model);
        return (async function* () { yield response; })();
      },
    } };
  };
  const scoped = (await f.create())!;
  assert.ok((await scoped.model.complete(request)).content.some((block) => block.type === "text" && block.text === "google"));
  assert.ok((await collect(scoped.model.stream(request))).some((event) => event.type === "text_delta" && event.text === "google"));
  assert.deepEqual(calls, ["auto", "auto"]);
});

test("local and interactive sessions are unchanged; managed automation missing bridge credentials fails closed", async () => {
  const f = setup();
  assert.equal(await createManagedAutomationRuntime({}, "cron:fixture", inherited, f.options), undefined);
  assert.equal(await createManagedAutomationRuntime(env, "web:fixture", inherited, f.options), undefined);
  assert.equal(await createManagedAutomationRuntime(env, "web:cron:fixture", inherited, f.options), undefined);
  assert.equal(f.calls.length, 0);
  await assert.rejects(createManagedAutomationRuntime({ ...env, PILOTDECK_MANAGED_LOCAL_KEY: undefined }, "always-on/discovery:fixture", inherited), /authenticated local bridge/);
});
