import {
  compact,
  type CompactionResult,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { CreateAgentSessionOptionsWithResourceLoader } from "./npm-package-fallback.js";

export function compactionTimeoutMs(): number {
  const configured = Number(process.env.PI_APP_COMPACTION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 2_147_483_647)
    : 150_000;
}

/** Tune summary requests without changing the session model, thinking level or cut point. */
export function compactionResourceOptions(): NonNullable<CreateAgentSessionOptionsWithResourceLoader["resourceLoaderOptions"]> {
  const summarize = async (
    event: SessionBeforeCompactEvent,
    ctx: ExtensionContext,
  ): Promise<{ compaction: CompactionResult } | { cancel: true }> => {
    if (!ctx.model || event.signal.aborted) return { cancel: true };
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return { cancel: true };

    // Preserve the SDK's selected history/recent messages. Only bound summary output.
    const preparation = {
      ...event.preparation,
      fileOps: {
        read: new Set(event.preparation.fileOps.read),
        edited: new Set(event.preparation.fileOps.edited),
        written: new Set(event.preparation.fileOps.written),
      },
      settings: {
        ...event.preparation.settings,
        reserveTokens: Math.min(event.preparation.settings.reserveTokens, 4_096),
      },
    };
    // SDK summaries returned through a hook are marked fromHook; carry forward only
    // our own validated SDK file lists, which the default extractor otherwise skips.
    const previous = event.branchEntries.filter((entry) => entry.type === "compaction").pop();
    const rawDetails = previous?.type === "compaction" ? previous.details : undefined;
    const details = rawDetails && typeof rawDetails === "object"
      ? rawDetails as Record<string, unknown> : undefined;
    if (details?.taosiSummary === 1) {
      for (const path of Array.isArray(details.readFiles) ? details.readFiles : []) {
        if (typeof path === "string") preparation.fileOps.read.add(path);
      }
      for (const path of Array.isArray(details.modifiedFiles) ? details.modifiedFiles : []) {
        if (typeof path === "string") preparation.fileOps.edited.add(path);
      }
    }
    const attemptMs = Math.max(1, Math.min(60_000, Math.floor(compactionTimeoutMs() * 0.4)));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptMs);
      const signal = AbortSignal.any([event.signal, controller.signal]);
      try {
        const result = await compact(preparation, ctx.model, auth.apiKey, auth.headers,
          event.customInstructions, signal, "off");
        // The SDK can return partial text on abort; never persist it as a finished summary.
        signal.throwIfAborted();
        if (!result.summary.trim()) throw new Error("Empty compaction summary");
        return { compaction: { ...result, details: { ...result.details as object, taosiSummary: 1 } } };
      } catch {
        if (event.signal.aborted) return { cancel: true };
      } finally {
        // compact() can run two summaries in parallel; abort an unfinished sibling.
        controller.abort();
        clearTimeout(timer);
      }
    }
    ctx.ui.notify("Context summary could not be completed after two attempts. Your conversation has been preserved.", "warning");
    // Returning cancel prevents the SDK from starting another unbounded fallback request.
    return { cancel: true };
  };
  return {
    extensionFactories: [(pi) => { pi.on("session_before_compact", summarize); }],
    extensionsOverride: (base) => {
      // A user-provided compaction hook owns this operation; do not run two summarizers.
      const hasCustomCompaction = base.extensions.some((extension) =>
        extension.handlers.get("session_before_compact")?.some((handler) => handler !== summarize));
      return hasCustomCompaction ? {
        ...base,
        extensions: base.extensions.filter((extension) =>
          !extension.handlers.get("session_before_compact")?.some((handler) => handler === summarize)),
      } : base;
    },
  };
}
