import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type StreamFn = AgentSession["agent"]["streamFn"];

function deadline(value: string | undefined, fallback: number): number {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? Math.min(Math.max(Math.round(ms), 250), 1_800_000) : fallback;
}

/** Bound model silence, not total run time. SDK HTTP deadlines end at response headers. */
export function withResponseWatchdog(
  upstream: StreamFn,
  timeouts = {
    firstResponseMs: deadline(process.env.PI_APP_MODEL_FIRST_RESPONSE_TIMEOUT_MS, 300_000),
    idleMs: deadline(process.env.PI_APP_MODEL_IDLE_TIMEOUT_MS, 120_000),
  },
): StreamFn {
  return (model, context, options) => {
    const output = createAssistantMessageEventStream();
    const controller = new AbortController();
    let source: Awaited<ReturnType<StreamFn>> | undefined;
    let partial: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [], stopReason: "stop", timestamp: Date.now(),
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    let finished = false;
    let receivedContent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (message: string, reason: "error" | "aborted") => {
      if (finished) return;
      finished = true;
      cleanup();
      // A provider may mutate its partial message even after cancellation.
      partial = { ...structuredClone(partial), stopReason: reason, errorMessage: message };
      for (const block of partial.content) {
        const streaming = block as typeof block & {
          index?: unknown; streamIndex?: unknown; partialArgs?: unknown; partialJson?: unknown;
        };
        delete streaming.index;
        delete streaming.streamIndex;
        delete streaming.partialArgs;
        delete streaming.partialJson;
      }
      output.push({ type: "error", reason, error: partial });
      output.end();
      controller.abort();
      // Release the consumer even when a third-party producer ignores AbortSignal.
      source?.end(partial);
    };
    const onAbort = () => fail("Request was cancelled.", "aborted");
    const arm = () => {
      if (timer) clearTimeout(timer);
      const ms = receivedContent ? timeouts.idleMs : timeouts.firstResponseMs;
      timer = setTimeout(() => {
        console.warn("[session-driver] Model response stalled.", {
          provider: model.provider, model: model.id,
          phase: receivedContent ? "streaming" : "first-content", silenceMs: ms,
        });
        // This is a local cancellation, so the SDK must not automatically retry it.
        fail(`Model response stalled: no ${receivedContent ? "new" : "initial"} content for ${Math.ceil(ms / 1000)} seconds. The request was stopped; received content is preserved. Retry when the model is ready.`, "aborted");
      }, ms);
      timer.unref?.();
    };

    if (options?.signal?.aborted) {
      onAbort();
      return output;
    }
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    arm();
    void (async () => {
      try {
        source = await upstream(model, context, {
          ...options,
          signal: controller.signal,
          onResponse: async (response, responseModel) => {
            if (!finished) await options?.onResponse?.(response, responseModel);
          },
        });
        if (finished) { source.end(partial); return; }
        for await (const event of source) {
          if (finished) return;
          if (event.type === "done" || event.type === "error") {
            finished = true;
            cleanup();
            output.push(event);
            output.end();
            return;
          }
          partial = event.partial;
          if ((event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") && event.delta.length > 0) {
            receivedContent = true;
            arm();
          }
          output.push(event);
        }
        if (!finished) fail("Model response stream closed without a completion event. Please retry.", "error");
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error), "error");
      }
    })();
    return output;
  };
}
