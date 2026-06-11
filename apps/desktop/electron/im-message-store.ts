import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const IM_DATA_DIR = join(homedir(), ".pi", "agent", "im", "messages");

export interface ImWebhookMessage {
  /** Message text from user */
  text: string;
  /** Sender ID on the IM platform */
  senderId: string;
  /** Sender display name */
  senderName?: string;
  /** Message timestamp */
  timestamp: string;
  /** Optional message type */
  messageType?: "text" | "image" | "file";
  /** Optional media URL */
  mediaUrl?: string;
}

export interface ImMessageRecord extends ImWebhookMessage {
  /** Unique message ID */
  id: string;
  /** Direction: "in" for incoming, "out" for outgoing (agent reply) */
  direction: "in" | "out";
  /** Channel ID */
  channelId: string;
  /** Provider */
  provider: string;
}

function ensureDir(provider: string, channelId: string): string {
  const dir = join(IM_DATA_DIR, provider, channelId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveImMessage(
  provider: string,
  channelId: string,
  message: ImMessageRecord,
): void {
  const dir = ensureDir(provider, channelId);
  const filePath = join(dir, `${channelId}.jsonl`);
  appendFileSync(filePath, JSON.stringify(message) + "\n");
}

export function createImMessageId(): string {
  return `im-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
