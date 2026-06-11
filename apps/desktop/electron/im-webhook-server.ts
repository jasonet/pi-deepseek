import http from "node:http";
import type { DesktopAppStore } from "./app-store";
import { saveImMessage, createImMessageId, type ImWebhookMessage } from "./im-message-store";

const DEFAULT_PORT = 8788;
const WEBHOOK_PATH = "/im/webhook";

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
        // Only handle POST /im/webhook
        if (req.method !== "POST" || req.url !== WEBHOOK_PATH) {
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
          const channel = findChannelForMessage(state.imChannels, msg);

          if (!channel || !channel.sessionId) {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, message: "No active session for this channel" }));
            return;
          }

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

          // Send to pi session
          try {
            const sessionRef = {
              workspaceId: findWorkspaceForSession(state, channel.sessionId),
              sessionId: channel.sessionId,
            };

            if (sessionRef.workspaceId) {
              const driver = (store as any).driver;
              if (driver?.sendUserMessage) {
                await driver.sendUserMessage(sessionRef, {
                  text: msg.text,
                  source: "im",
                });
              }
            }
          } catch (e) {
            console.error("[IM Webhook] Failed to send to session:", e);
          }

          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, messageId }));
        } catch (e) {
          console.error("[IM Webhook] Error:", e);
          res.writeHead(500);
          res.end(JSON.stringify({ error: "Internal error" }));
        }
      });

      server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.warn(`[IM Webhook] Port ${port} already in use, skipping`);
        } else {
          console.error("[IM Webhook] Server error:", err);
        }
      });

      return new Promise<void>((resolve) => {
        server!.listen(port, "127.0.0.1", () => {
          console.log(`[IM Webhook] Listening on http://127.0.0.1:${port}${WEBHOOK_PATH}`);
          resolve();
        });
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
    return {
      text: json.text || json.content || json.message || "",
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
      senderId: params.get("senderId") || params.get("from") || "",
      senderName: params.get("senderName") || "",
      timestamp: params.get("timestamp") || new Date().toISOString(),
    };
  }
}

function findChannelForMessage(
  channels: readonly any[],
  _msg: ImWebhookMessage,
): any | undefined {
  // For now, return the first enabled channel with a sessionId
  return channels.find((c: any) => c.enabled && c.sessionId);
}

function findWorkspaceForSession(state: any, sessionId: string): string {
  for (const ws of state.workspaces ?? []) {
    if (ws.sessions?.some((s: any) => s.id === sessionId)) {
      return ws.id;
    }
  }
  return "";
}
