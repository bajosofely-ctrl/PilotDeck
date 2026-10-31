import { parseModelConfig } from "./config/parseModelConfig.js";
import { createModelRuntime, type ModelRuntime } from "./ModelRuntime.js";
import type { CanonicalModelRequest, ModelConfig, ModelProtocol } from "./protocol/canonical.js";
import { ModelRequestError } from "./protocol/errors.js";
import type { ModelRuntimeOptions } from "./streaming/streamModel.js";
import type { PilotAgentModelSelection } from "../pilot/config/types.js";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const PROTOCOLS = new Set<ModelProtocol>(["openai", "openai-responses", "anthropic", "google"]);

export function isAutomationSession(sessionId: string): boolean {
  return sessionId.startsWith("cron:") || sessionId.startsWith("always-on/");
}

type CatalogModel = {
  id: string;
  name: string;
  protocol: ModelProtocol;
  capabilities: string[];
  maxInputTokens: number;
  maxOutputTokens: number;
};

type Catalog = { models: CatalogModel[]; defaultModelId: string };

export type ManagedAutomationRuntime = {
  config: ModelConfig;
  selection: PilotAgentModelSelection;
  model: ModelRuntime;
};

/**
 * Bind application ownership to the gateway's session context, never request
 * metadata or a provider URL supplied by a model. The returned runtime is private
 * to that session (including its subagents, titles and compaction).
 */
export async function createManagedAutomationRuntime(
  env: Record<string, string | undefined>,
  sessionId: string,
  inheritedModel: Pick<PilotAgentModelSelection, "provider" | "model">,
  options: ModelRuntimeOptions = {},
): Promise<ManagedAutomationRuntime | undefined> {
  if (!env.PILOTDECK_MANAGED_URL || !isAutomationSession(sessionId)) return undefined;
  const port = Number(env.SERVER_PORT);
  const localKey = env.PILOTDECK_MANAGED_LOCAL_KEY;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !localKey) {
    throw new ModelRequestError("auth_error", "Managed automation requires an authenticated local bridge.");
  }
  const origin = `http://127.0.0.1:${port}`;
  const readCatalog = async (signal?: AbortSignal): Promise<Catalog> => {
    const timeout = AbortSignal.timeout(15000);
    const response = await (options.fetch ?? fetch)(`${origin}/api/managed/automation/models`, {
      headers: { Authorization: `Bearer ${localKey}`, Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
    });
    if (!response.ok) {
      // Do not retain or log upstream response bodies, which may contain secrets.
      throw new ModelRequestError(
        response.status === 401 || response.status === 403 ? "auth_error" : "provider_error",
        `Automation model authorization failed (HTTP ${response.status}).`,
      );
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") throw invalidCatalog();
    const record = data as { models?: unknown; items?: unknown; defaultModelId?: unknown };
    const models = record.models ?? record.items;
    if (!Array.isArray(models) || !models.length) {
      throw new ModelRequestError("model_not_found", "No authorized automation models are available.");
    }
    const seen = new Set<string>();
    for (const model of models) {
      if (!model || typeof model.id !== "string" || !ID.test(model.id) || seen.has(model.id) ||
          !PROTOCOLS.has(model.protocol) ||
          !Number.isSafeInteger(model.maxInputTokens) || model.maxInputTokens <= 0 ||
          !Number.isSafeInteger(model.maxOutputTokens) || model.maxOutputTokens <= 0 ||
          !Array.isArray(model.capabilities) || model.capabilities.some((value: unknown) => typeof value !== "string")) {
        throw invalidCatalog();
      }
      seen.add(model.id);
    }
    const defaultModelId = record.defaultModelId ?? models[0].id;
    if (typeof defaultModelId !== "string" || !seen.has(defaultModelId)) throw invalidCatalog();
    return { models, defaultModelId };
  };
  const configure = (catalog: Catalog): ModelConfig => parseModelConfig({
    providers: Object.fromEntries(catalog.models.map((model) => [`managed_${model.id}`, {
      protocol: model.protocol,
      url: `${origin}/api/managed/relay/automation/${encodeURIComponent(model.id)}${model.protocol === "google" ? "/v1beta" : ""}`,
      apiKey: localKey,
      retry: { requestMaxRetries: 0, streamMaxRetries: 0 },
      models: {
        [model.id]: {
          displayName: model.name || model.id,
          capabilities: { maxContextTokens: model.maxInputTokens + model.maxOutputTokens, maxOutputTokens: model.maxOutputTokens },
          multimodal: {
            input: model.capabilities.includes("image") ? ["text", "image"] : ["text"],
            maxImageBytes: 1024 * 1024,
            supportedImageMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
          },
        },
      },
    }])),
  });
  const initial = await readCatalog(options.signal);
  const config = configure(initial);
  const selection = modelSelection(initial.defaultModelId);
  const initialRuntime = createModelRuntime(config, options);
  const metadataSelection = (provider: string, model: string) => config.providers[provider]?.models[model]
    ? { provider, model } : selection;
  const prepare = async (request: CanonicalModelRequest, signal?: AbortSignal) => {
    const catalog = await readCatalog(signal);
    // Gateway turn defaults may still refer to the shared chat configuration.
    // Inherited defaults follow the current automation default, never chat.
    const inherited = (request.provider === inheritedModel.provider && request.model === inheritedModel.model) ||
      (request.provider === selection.provider && request.model === selection.model);
    const selectedId = inherited ? catalog.defaultModelId : request.model;
    if (!catalog.models.some((model) => model.id === selectedId)) {
      throw new ModelRequestError("model_not_found", "The selected model is not authorized for automation.");
    }
    const selected = modelSelection(selectedId);
    const currentConfig = configure(catalog);
    const native = createModelRuntime(currentConfig, options);
    const cap = native.getCapabilities(selected.provider, selected.model).maxOutputTokens;
    return {
      native,
      request: {
        ...request, provider: selected.provider, model: selected.model,
        maxOutputTokens: Math.min(request.maxOutputTokens ?? cap, cap),
        cachePlan: undefined, cacheBreakpoints: undefined,
      },
    };
  };
  return {
    config, selection,
    model: {
      ...initialRuntime,
      getCapabilities(provider, model) {
        const selected = metadataSelection(provider, model);
        return initialRuntime.getCapabilities(selected.provider, selected.model);
      },
      getMultimodal(provider, model) {
        const selected = metadataSelection(provider, model);
        return initialRuntime.getMultimodal(selected.provider, selected.model);
      },
      getProviderProtocol: (provider) => initialRuntime.getProviderProtocol(provider) ??
        initialRuntime.getProviderProtocol(selection.provider),
      getProviderBaseUrl: (provider) => initialRuntime.getProviderBaseUrl(provider) ??
        initialRuntime.getProviderBaseUrl(selection.provider),
      async *stream(request, callOptions) {
        const prepared = await prepare(request, callOptions?.signal ?? options.signal);
        yield* prepared.native.stream(prepared.request, callOptions);
      },
      async complete(request, callOptions) {
        const prepared = await prepare(request, callOptions?.signal ?? options.signal);
        return prepared.native.complete(prepared.request, callOptions);
      },
    },
  };
}

function modelSelection(id: string): PilotAgentModelSelection {
  return { id: `managed_${id}/${id}`, provider: `managed_${id}`, model: id };
}

function invalidCatalog() {
  return new ModelRequestError("invalid_request", "The authorized automation model catalog is invalid.");
}
