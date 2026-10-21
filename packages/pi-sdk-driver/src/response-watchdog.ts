import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

type StreamFn = AgentSession["agent"]["streamFn"];
export type SteerableStreamFn = StreamFn & { steer(queued: boolean): void };

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
    steerIdleMs: deadline(process.env.PI_APP_STEER_IDLE_TIMEOUT_MS, 10_000),
    steerMaxMs: deadline(process.env.PI_APP_STEER_MAX_WAIT_MS, 30_000),
  },
): SteerableStreamFn {
  let activeSteer: ((queued: boolean) => void) | undefined;
  const stream: StreamFn = (model, context, options) => {
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
    let lastContentAt = Date.now();
    let steerQueuedAt: number | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onAbort);
      if (activeSteer === requestSteer) activeSteer = undefined;
    };
    const finalPartial = (reason: "stop" | "error" | "aborted", message?: string): AssistantMessage => {
      const result = { ...structuredClone(partial), stopReason: reason, ...(message ? { errorMessage: message } : {}) };
      for (const block of result.content) {
        const streaming = block as typeof block & {
          index?: unknown; streamIndex?: unknown; partialArgs?: unknown; partialJson?: unknown;
        };
        delete streaming.index;
        delete streaming.streamIndex;
        delete streaming.partialArgs;
        delete streaming.partialJson;
      }
      return result;
    };
    const fail = (message: string, reason: "error" | "aborted") => {
      if (finished) return;
      finished = true;
      cleanup();
      // A provider may mutate its partial message even after cancellation.
      partial = finalPartial(reason, message);
      output.push({ type: "error", reason, error: partial });
      output.end();
      controller.abort();
      // Release the consumer even when a third-party producer ignores AbortSignal.
      source?.end(partial);
    };
    const advanceForSteer = () => {
      if (finished) return;
      finished = true;
      cleanup();
      partial = { ...partial, content: partial.content.filter((block) => block.type === "text" && block.text.trim().length > 0) };
      partial = finalPartial("stop");
      // An unfinished tool call must never execute or be sent to the next model request.
      if (partial.content.length === 0) {
        partial.content = [{ type: "text", text: "Response interrupted to follow the new instruction." }];
      }
      output.push({ type: "done", reason: "stop", message: partial });
      output.end();
      controller.abort();
      source?.end(partial);
    };
    const onAbort = () => fail("Request was cancelled.", "aborted");
    const steerIdleMs = timeouts.steerIdleMs ?? 10_000;
    const steerMaxMs = timeouts.steerMaxMs ?? 30_000;
    const arm = () => {
      if (timer) clearTimeout(timer);
      const normalMs = receivedContent ? timeouts.idleMs : timeouts.firstResponseMs;
      const normalDeadline = lastContentAt + normalMs;
      const steerDeadline = steerQueuedAt === undefined ? Infinity : Math.min(
        lastContentAt + steerIdleMs,
        steerQueuedAt + steerMaxMs,
      );
      const dueAt = Math.min(normalDeadline, steerDeadline);
      timer = setTimeout(() => {
        if (steerQueuedAt !== undefined) {
          advanceForSteer();
          return;
        }
        console.warn("[session-driver] Model response stalled.", {
          provider: model.provider, model: model.id,
          phase: receivedContent ? "streaming" : "first-content", silenceMs: normalMs,
        });
        // This is a local cancellation, so the SDK must not automatically retry it.
        fail(`Model response stalled: no ${receivedContent ? "new" : "initial"} content for ${Math.ceil(normalMs / 1000)} seconds. The request was stopped; received content is preserved. Retry when the model is ready.`, "aborted");
      }, Math.max(0, dueAt - Date.now()));
      timer.unref?.();
    };
    const requestSteer = (queued: boolean) => {
      if (finished) return;
      if (queued) steerQueuedAt ??= Date.now();
      else steerQueuedAt = undefined;
      arm();
    };

    if (options?.signal?.aborted) {
      onAbort();
      return output;
    }
    activeSteer = requestSteer;
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
            lastContentAt = Date.now();
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
  return Object.assign(stream, { steer: (queued: boolean) => activeSteer?.(queued) });
}
