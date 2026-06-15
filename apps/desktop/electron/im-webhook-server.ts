import http from "node:http";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import type { DesktopAppStore } from "./app-store";
import { saveImMessage, createImMessageId, type ImWebhookMessage } from "./im-message-store";
import type { ImChannel } from "../src/desktop-state";

const DEFAULT_PORT = 8789;
const WEBHOOK_PATH = "/im/webhook";
const LEGACY_WEBHOOK_PATH = "/claw/im";

export interface ImWebhookServer {
  readonly port: number;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

export function createImWebhookServer(store: DesktopAppStore): ImWebhookServer {
  let server: http.Server | null = null;
  const port = parseInt(process.env.IM_WEBHOOK_PORT || "", 10) || DEFAULT_PORT;

  const serverImpl: ImWebhookServer = {
    port,
    async start() {
      if (server) return;
      server = http.createServer(async (req, res) => {
        // Health check
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

        if (req.method === "GET" && (url.pathname === "/im/health" || isWebhookPath(url.pathname))) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            message: "IM webhook server running",
            accepts: ["POST"],
            webhookUrl: `http://127.0.0.1:${port}${WEBHOOK_PATH}`,
            legacyWebhookUrl: `http://127.0.0.1:${port}${LEGACY_WEBHOOK_PATH}`,
          }));
          return;
        }
        if (req.method === "OPTIONS" && isWebhookPath(url.pathname)) {
          res.writeHead(204, {
            allow: "GET, POST, OPTIONS",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type, authorization, x-deepseek-gui-secret",
          });
          res.end();
          return;
        }
        // Handle the Pi webhook path and Kun/OpenClaw's legacy default path.
        if (req.method !== "POST" || !isWebhookPath(url.pathname)) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        try {
          const body = await readRequestBody(req);
          const msg = parseWebhookBody(body);

          if (!msg.text?.trim()) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing message text" }));
            return;
          }

          // Find matching IM channel by message source
          const state = store.state;
          const channelTarget = await findChannelTargetForMessage(store, state.imChannels, msg);

          if (!channelTarget) {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, message: "No active session for this channel" }));
            return;
          }
          const { channel, sessionRef } = channelTarget;

          // Open + subscribe the session through the app-store before sending so
          // the desktop transcript cache stays in sync and driver.subscribe below
          // does not throw "Unknown session" for a session that isn't open yet.
          await store.ensureSessionReady(sessionRef);

          // Optimistically show the inbound phone message in the bound desktop
          // session right away (the composer does the same for typed messages).
          await store.appendInboundUserMessage(sessionRef, msg.text).catch(() => {});

          // Save incoming message
          const messageId = createImMessageId();
          saveImMessage(channel.provider, channel.id, {
            id: messageId,
            channelId: channel.id,
            provider: channel.provider,
            direction: "in",
            text: msg.text,
            senderId: msg.senderId,
            senderName: msg.senderName,
            timestamp: msg.timestamp || new Date().toISOString(),
          });

          // Send to pi session and wait for reply
          let reply = "";
          try {
            const driver = store.driver;
            if (driver.sendUserMessage) {
              // Subscribe to session events to capture the reply
              const replyPromise = new Promise<string>((resolve) => {
                const unsubscribe = driver.subscribe(sessionRef, async (event: SessionDriverEvent) => {
                  if (event.type === "runCompleted") {
                    const text = await readLastAssistantText(store, sessionRef);
                    resolve(text);
                    unsubscribe();
                  } else if (event.type === "runFailed") {
                    resolve("Agent run failed");
                    unsubscribe();
                  }
                });
                // Timeout after 5 minutes
                setTimeout(() => { resolve("Agent timeout"); unsubscribe(); }, 300_000);
              });

              await driver.sendUserMessage(sessionRef, {
                text: msg.text,
              });

              reply = await replyPromise;

              // Refresh the desktop transcript from the driver so the phone
              // message and the agent reply both appear in the bound session.
              await store.reloadTranscriptFromDriver(sessionRef).catch(() => {});

              // Save outgoing reply
              saveImMessage(channel.provider, channel.id, {
                id: createImMessageId(),
                channelId: channel.id,
                provider: channel.provider,
                direction: "out",
                text: reply,
                senderId: "agent",
                timestamp: new Date().toISOString(),
              });
            }
          } catch (e) {
            console.error("[IM Webhook] Agent error:", e);
            reply = "Error: " + (e instanceof Error ? e.message : String(e));
          }

          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, messageId, reply: reply.slice(0, 500) }));
        } catch (e) {
          console.error("[IM Webhook] Error:", e);
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Internal error" }));
        }
      });

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.warn(`[IM Webhook] Port ${port} already in use, skipping`);
        } else {
          console.error("[IM Webhook] Server error:", err);
        }
      });

      return new Promise<void>((resolve, reject) => {
        const serverToStart = server!;
        const onError = (error: Error) => {
          serverToStart.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          serverToStart.off("error", onError);
          console.log(`[IM Webhook] Listening on http://0.0.0.0:${port}${WEBHOOK_PATH}`);
          resolve();
        };
        serverToStart.once("error", onError);
        serverToStart.once("listening", onListening);
        serverToStart.listen(port, "0.0.0.0");
      });
    },

    async stop() {
      if (server) {
        server.close();
        server = null;
      }
    },
  };

  return serverImpl;
}

function isWebhookPath(pathname: string): boolean {
  return pathname === WEBHOOK_PATH || pathname === LEGACY_WEBHOOK_PATH;
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseWebhookBody(body: string): ImWebhookMessage {
  try {
    const json = JSON.parse(body);
    const nestedMessage = isRecord(json.message) ? json.message : {};
    return {
      text: readString(json.text) || readString(json.content) || readString(nestedMessage.text) || "",
      channelId: readString(json.channelId) || readString(nestedMessage.channelId),
      provider: readString(json.provider) || readString(json.platform) || readString(nestedMessage.provider),
      accountId: readString(json.accountId) || readString(nestedMessage.accountId),
      senderId: json.senderId || json.from || json.user_id || "",
      senderName: json.senderName || json.sender_name || "",
      timestamp: json.timestamp || json.time || new Date().toISOString(),
      messageType: json.messageType || json.msg_type || "text",
      mediaUrl: json.mediaUrl || json.media_url,
    };
  } catch {
    // Try URL-encoded form
    const params = new URLSearchParams(body);
    return {
      text: params.get("text") || params.get("content") || "",
      channelId: params.get("channelId") || undefined,
      provider: params.get("provider") || undefined,
      accountId: params.get("accountId") || undefined,
      senderId: params.get("senderId") || params.get("from") || "",
      senderName: params.get("senderName") || "",
      timestamp: params.get("timestamp") || new Date().toISOString(),
    };
  }
}

async function findChannelTargetForMessage(
  store: DesktopAppStore,
  channels: readonly ImChannel[],
  msg: ImWebhookMessage,
): Promise<{ readonly channel: ImChannel; readonly sessionRef: SessionRef } | undefined> {
  const sessions = await store.driver.listSessions().catch(() => ({ sessions: [] }));
  const sessionRefsById = new Map<string, SessionRef>();
  for (const session of sessions.sessions) {
    sessionRefsById.set(session.sessionRef.sessionId, session.sessionRef);
  }
  const candidates = channels.filter((channel) => (
    channel.enabled && channel.sessionId && sessionRefsById.has(channel.sessionId)
  ));
  const channel = candidates.find((candidate) => candidate.id === msg.channelId)
    ?? candidates.find((channel) => channel.provider === msg.provider && credentialAccountId(channel) === msg.accountId)
    ?? candidates.find((channel) => channel.provider === msg.provider)
    ?? candidates[0];
  const sessionRef = channel?.sessionId ? sessionRefsById.get(channel.sessionId) : undefined;
  return channel && sessionRef ? { channel, sessionRef } : undefined;
}

async function readLastAssistantText(store: DesktopAppStore, sessionRef: SessionRef): Promise<string> {
  const transcript = await store.driver.getTranscript(sessionRef);
  const lastAssistant = [...transcript].reverse().find((message) => message.role === "assistant");
  return lastAssistant?.text.trim() || "";
}

function credentialAccountId(channel: ImChannel): string | undefined {
  return channel.credential.kind === "weixin" ? channel.credential.accountId : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
