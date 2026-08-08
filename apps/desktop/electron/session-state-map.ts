import type { SessionConfig } from "@pi-gui/session-driver";
import { createEmptyExtensionUiState as createBaseExtensionUiState, type ExtensionUiState } from "@pi-gui/pi-sdk-driver";
import type { RuntimeCommandRecord } from "@pi-gui/session-driver/runtime-types";
import type {
  ComposerAttachment,
  QueuedComposerMessage,
  SessionExtensionDialogRecord,
  SessionExtensionUiStateRecord,
  TranscriptMessage,
} from "../src/desktop-state";
import type { RunMetrics } from "./app-store-timeline";

export interface MutableSessionExtensionUiState extends ExtensionUiState {
  pendingDialogs: SessionExtensionDialogRecord[];
}

export interface PendingAutoTitle {
  readonly requestToken: string;
  readonly cancel: () => void;
}

export interface QueuedComposerEditState {
  readonly messageId: string;
  readonly restoreDraft: string;
  readonly restoreAttachments: readonly ComposerAttachment[];
}

/** Maximum number of sessions whose full transcripts are kept in memory.
 * Beyond this limit, the oldest (least recently used) transcript is evicted
 * and must be reloaded from disk on next access. */
const TRANSCRIPT_CACHE_MAX_SIZE = 12;

/** Maximum length of a single cached transcript. Prevents unbounded growth
 * from runaway sessions generating thousands of messages. */
const TRANSCRIPT_MAX_ITEMS = 500;

/** Maximum number of sessions for which we retain per-session Maps
 * (commands, configs, drafts, extension UI, etc.). Beyond this limit,
 * the oldest idle/completed session's data is evicted. Running sessions
 * are never evicted. */
const SESSION_DATA_MAX_SIZE = 64;

/**
 * Consolidates all per-session Maps (and one Set) that DesktopAppStore
 * maintains for runtime session state.  Having them in a single class
 * makes pruning and deletion consistent — every map is cleaned in one
 * place instead of manually repeating the list across call sites.
 */
export class SessionStateMap {
  readonly transcriptCache = new Map<string, TranscriptMessage[]>();
  /** LRU order for transcript cache eviction. Front = most recently used. */
  private readonly transcriptCacheOrder: string[] = [];
  readonly composerDraftsBySession = new Map<string, string>();
  readonly composerAttachmentsBySession = new Map<string, ComposerAttachment[]>();
  readonly queuedComposerMessagesBySession = new Map<string, QueuedComposerMessage[]>();
  readonly queuedComposerEditsBySession = new Map<string, QueuedComposerEditState>();
  readonly sessionConfigBySession = new Map<string, SessionConfig>();
  readonly lastViewedAtBySession = new Map<string, string>();
  readonly sessionErrorsBySession = new Map<string, string>();
  readonly sessionSubscriptions = new Map<string, () => void>();
  readonly activeAssistantMessageBySession = new Map<string, string>();
  readonly runningSinceBySession = new Map<string, string>();
  readonly runMetricsBySession = new Map<string, RunMetrics>();
  readonly activeWorkingActivityBySession = new Map<string, string>();
  readonly sessionCommandsBySession = new Map<string, RuntimeCommandRecord[]>();
  readonly extensionUiBySession = new Map<string, MutableSessionExtensionUiState>();
  readonly pendingAutoTitleBySession = new Map<string, PendingAutoTitle>();
  readonly loadedTranscriptKeys = new Set<string>();

  /**
   * Remove entries for session keys that are no longer active.
   * Calls the unsubscribe callback for any stale subscription before deleting it.
   * Also evicts idle/completed session data when the total count exceeds
   * SESSION_DATA_MAX_SIZE, preventing unbounded growth during long-running
   * multi-workspace sessions.
   */
  prune(activeKeys: Set<string>): void {
    // 1. Unsubscribe and clean any session whose subscription key is stale.
    for (const [key, unsubscribe] of this.sessionSubscriptions) {
      if (!activeKeys.has(key)) {
        unsubscribe();
        this.deleteSession(key);
      }
    }

    // 2. Collect all session keys that still have data in any Map.
    const staleKeys = new Set<string>();
    for (const map of [
      this.composerDraftsBySession,
      this.composerAttachmentsBySession,
      this.sessionConfigBySession,
      this.sessionCommandsBySession,
      this.extensionUiBySession,
      this.lastViewedAtBySession,
    ]) {
      for (const key of map.keys()) {
        if (!activeKeys.has(key)) {
          staleKeys.add(key);
        }
      }
    }

    // 3. If we're over the limit, evict the oldest idle/completed sessions.
    // Running sessions (those with subscriptions) are never evicted.
    if (staleKeys.size > SESSION_DATA_MAX_SIZE) {
      const excess = staleKeys.size - SESSION_DATA_MAX_SIZE;
      // Evict in FIFO order — oldest stale entries first.
      let evicted = 0;
      for (const key of staleKeys) {
        if (evicted >= excess) break;
        if (this.sessionSubscriptions.has(key)) continue; // skip running
        this.deleteSession(key);
        evicted += 1;
      }
    }
  }

  /** Record a transcript access for LRU tracking. Call whenever a transcript
   * is read from or written to the cache. */
  touchTranscriptCache(key: string): void {
    const idx = this.transcriptCacheOrder.indexOf(key);
    if (idx !== -1) {
      this.transcriptCacheOrder.splice(idx, 1);
    }
    this.transcriptCacheOrder.unshift(key);
    this.evictTranscriptCacheIfNeeded();
  }

  /** Evict oldest transcripts when the cache exceeds the limit. */
  private evictTranscriptCacheIfNeeded(): void {
    while (this.transcriptCacheOrder.length > TRANSCRIPT_CACHE_MAX_SIZE) {
      const oldest = this.transcriptCacheOrder.pop();
      if (oldest) {
        this.transcriptCache.delete(oldest);
        this.loadedTranscriptKeys.delete(oldest);
      }
    }
  }

  /** Trim a transcript to the maximum allowed items before caching. */
  static trimTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
    if (transcript.length <= TRANSCRIPT_MAX_ITEMS) return transcript;
    return transcript.slice(-TRANSCRIPT_MAX_ITEMS);
  }

  /** Remove all state for a single session key. */
  deleteSession(key: string): void {
    const pendingAutoTitle = this.pendingAutoTitleBySession.get(key);
    this.sessionSubscriptions.delete(key);
    this.activeAssistantMessageBySession.delete(key);
    this.runningSinceBySession.delete(key);
    this.runMetricsBySession.delete(key);
    this.activeWorkingActivityBySession.delete(key);
    this.composerDraftsBySession.delete(key);
    this.composerAttachmentsBySession.delete(key);
    this.queuedComposerMessagesBySession.delete(key);
    this.queuedComposerEditsBySession.delete(key);
    this.sessionConfigBySession.delete(key);
    this.lastViewedAtBySession.delete(key);
    this.sessionErrorsBySession.delete(key);
    this.sessionCommandsBySession.delete(key);
    this.extensionUiBySession.delete(key);
    this.pendingAutoTitleBySession.delete(key);
    pendingAutoTitle?.cancel();
    this.loadedTranscriptKeys.delete(key);
    this.transcriptCache.delete(key);
    const orderIdx = this.transcriptCacheOrder.indexOf(key);
    if (orderIdx !== -1) this.transcriptCacheOrder.splice(orderIdx, 1);
  }
}

export function createEmptyExtensionUiState(): MutableSessionExtensionUiState {
  return {
    ...createBaseExtensionUiState(),
    pendingDialogs: [],
  };
}

export function serializeExtensionUiState(state: MutableSessionExtensionUiState): SessionExtensionUiStateRecord {
  return {
    statuses: [...state.statuses.entries()].map(([key, text]) => ({ key, text })),
    widgets: [...state.widgets.values()],
    pendingDialogs: [...state.pendingDialogs],
    ...(state.title ? { title: state.title } : {}),
    ...(state.editorText ? { editorText: state.editorText } : {}),
  };
}
