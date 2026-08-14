import type { DshWebStatus } from "../src/ipc";

const DEFAULT_DSH_WEB_URL = "http://127.0.0.1:3080";
const DSH_PROBE_TIMEOUT_MS = 2_000;
const DSH_NOT_RUNNING_MESSAGE =
  "未检测到本机 DSH Web 服务。请在终端运行：npx @deepseek-ai/dsh web";

export class DshWebService {
  private pendingStart: Promise<DshWebStatus> | undefined;
  private status: DshWebStatus = { state: "idle" };

  async getStatus(): Promise<DshWebStatus> {
    if (this.status.state !== "running" || !this.status.url) {
      return this.status;
    }
    if (await probeDshWeb(this.status.url)) {
      return this.status;
    }
    this.status = notRunningStatus();
    return this.status;
  }

  start(): Promise<DshWebStatus> {
    if (this.pendingStart) {
      return this.pendingStart;
    }

    this.pendingStart = this.connect().finally(() => {
      this.pendingStart = undefined;
    });
    return this.pendingStart;
  }

  stop(): Promise<DshWebStatus> {
    this.pendingStart = undefined;
    this.status = { state: "idle" };
    return Promise.resolve(this.status);
  }

  private async connect(): Promise<DshWebStatus> {
    const url = resolveDshWebUrl();
    this.status = { state: "starting" };
    if (await probeDshWeb(url)) {
      this.status = {
        state: "running",
        url,
      };
    } else {
      this.status = notRunningStatus();
    }
    return this.status;
  }
}

function notRunningStatus(): DshWebStatus {
  return {
    state: "error",
    message: DSH_NOT_RUNNING_MESSAGE,
  };
}

async function probeDshWeb(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DSH_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveDshWebUrl(): string {
  const configured = process.env.PI_APP_DSH_WEB_URL?.trim();
  if (!configured) return `${DEFAULT_DSH_WEB_URL}/`;
  try {
    const url = new URL(configured);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return url.toString();
    }
  } catch {}
  return `${DEFAULT_DSH_WEB_URL}/`;
}
