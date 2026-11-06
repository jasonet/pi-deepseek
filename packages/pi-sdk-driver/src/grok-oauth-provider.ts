import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { getOAuthProvider, getOAuthProviders, registerOAuthProvider } from "@earendil-works/pi-ai/oauth";
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProviderInterface,
} from "@earendil-works/pi-ai/oauth";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AuthStorage } from "@earendil-works/pi-coding-agent";

export { getOAuthProvider, getOAuthProviders, registerOAuthProvider };

export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_ISSUER_URL = "https://auth.x.ai";
export const XAI_AUTHORIZE_URL = "https://auth.x.ai/oauth2/authorize";
export const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const XAI_USERINFO_URL = "https://auth.x.ai/oauth2/userinfo";
export const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_CALLBACK_HOST = "127.0.0.1";

export interface PKCEPair {
  readonly verifier: string;
  readonly challenge: string;
}

export function generatePKCE(): PKCEPair {
  const verifierBytes = crypto.randomBytes(32);
  const verifier = verifierBytes.toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createRandomState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function buildAuthorizationUrl(options: {
  readonly challenge: string;
  readonly state: string;
  readonly redirectUri: string;
}): string {
  const url = new URL(XAI_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", XAI_CLIENT_ID);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", XAI_SCOPE);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  url.searchParams.set("referrer", "fx");
  return url.toString();
}

export function parseAuthorizationInput(input: string): { readonly code?: string; readonly state?: string } {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    const code = url.searchParams.get("code") ?? undefined;
    const state = url.searchParams.get("state") ?? undefined;
    return {
      ...(code ? { code } : {}),
      ...(state ? { state } : {}),
    };
  } catch {
    // not a valid URL
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return {
      ...(code ? { code } : {}),
      ...(state ? { state } : {}),
    };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    const code = params.get("code") ?? undefined;
    const state = params.get("state") ?? undefined;
    return {
      ...(code ? { code } : {}),
      ...(state ? { state } : {}),
    };
  }
  return { code: value };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadPart = parts[1];
    if (!payloadPart) return null;
    const json = Buffer.from(payloadPart, "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchAccountId(accessToken: string): Promise<string> {
  try {
    const response = await fetch(XAI_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const json = (await response.json()) as { sub?: string; email?: string };
      if (typeof json.sub === "string" && json.sub.trim()) return json.sub.trim();
      if (typeof json.email === "string" && json.email.trim()) return json.email.trim();
    }
  } catch {
    // ignore
  }

  const payload = decodeJwtPayload(accessToken);
  if (payload && typeof payload.sub === "string" && payload.sub.trim()) {
    return payload.sub.trim();
  }

  return "xai-account";
}

interface LocalOAuthServer {
  readonly server: http.Server;
  readonly port: number;
  readonly redirectUri: string;
  waitForCode(): Promise<string | null>;
  cancelWait(): void;
  close(): void;
}

function renderHtmlResponse(title: string, heading: string, message: string, isError = false): string {
  const headingColor = isError ? "#ef4444" : "#4ade80";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      text-align: center;
      padding: 24px;
    }
    .card {
      max-width: 480px;
      padding: 32px 24px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    }
    h2 { margin: 0 0 12px; font-size: 20px; color: ${headingColor}; }
    p { margin: 0; font-size: 14px; color: #94a3b8; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${heading}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

async function startLocalOAuthServer(state: string): Promise<LocalOAuthServer> {
  let settleWait: ((value: string | null) => void) | undefined;
  let settled = false;

  const waitForCodePromise = new Promise<string | null>((resolve) => {
    settleWait = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || "", `http://${XAI_CALLBACK_HOST}`);
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtmlResponse("Not Found", "Page Not Found", "The requested path is not recognized.", true));
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtmlResponse("Authorization Failed", "xAI Authorization Denied", error, true));
        settleWait?.(null);
        return;
      }

      const returnedState = url.searchParams.get("state");
      if (returnedState !== state) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtmlResponse("State Mismatch", "Authentication Error", "State parameter mismatch. Please retry.", true));
        settleWait?.(null);
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtmlResponse("Missing Code", "Authentication Error", "Missing authorization code from xAI.", true));
        settleWait?.(null);
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderHtmlResponse("Taosi - xAI Grok Login", "xAI Grok Authentication Completed", "You can close this tab and return to Taosi."));
      settleWait?.(code);
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderHtmlResponse("Server Error", "Internal Server Error", "An unexpected error occurred during callback processing.", true));
      settleWait?.(null);
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    // Attempt preferred port 1456, then fall back to dynamic ephemeral port 0
    server.listen(1456, XAI_CALLBACK_HOST, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : 1456;
      resolve(actualPort);
    });

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Fall back to ephemeral port 0
        server.listen(0, XAI_CALLBACK_HOST, () => {
          const address = server.address();
          const actualPort = typeof address === "object" && address ? address.port : 0;
          resolve(actualPort);
        });
      } else {
        reject(err);
      }
    });
  });

  const redirectUri = `http://${XAI_CALLBACK_HOST}:${port}/callback`;

  return {
    server,
    port,
    redirectUri,
    waitForCode: () => waitForCodePromise,
    cancelWait: () => {
      settleWait?.(null);
    },
    close: () => {
      try {
        server.close();
      } catch {
        // ignore
      }
    },
  };
}

export async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<{ readonly accessToken: string; readonly refreshToken: string; readonly expiresIn: number }> {
  const response = await fetch(XAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: XAI_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`xAI Grok token exchange failed (${response.status}): ${text || response.statusText}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error(`xAI Grok token exchange response missing fields: ${JSON.stringify(json)}`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

export async function refreshGrokToken(
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  const response = await fetch(XAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: XAI_CLIENT_ID,
      refresh_token: credentials.refresh,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`xAI Grok token refresh failed (${response.status}): ${text || response.statusText}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!json.access_token || typeof json.expires_in !== "number") {
    throw new Error(`xAI Grok token refresh response missing fields: ${JSON.stringify(json)}`);
  }

  const accountId = (typeof credentials.accountId === "string" && credentials.accountId)
    ? credentials.accountId
    : await fetchAccountId(json.access_token);

  return {
    ...credentials,
    access: json.access_token,
    refresh: json.refresh_token || credentials.refresh,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

export async function loginGrok(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const { verifier, challenge } = generatePKCE();
  const state = createRandomState();
  const server = await startLocalOAuthServer(state);

  const authUrl = buildAuthorizationUrl({
    challenge,
    state,
    redirectUri: server.redirectUri,
  });

  callbacks.onAuth({
    url: authUrl,
    instructions: "A browser window should open. Log in to your xAI / Grok account to finish authorization.",
  });

  let code: string | undefined;
  try {
    if (callbacks.onManualCodeInput) {
      let manualCode: string | undefined;
      let manualError: Error | undefined;

      const manualPromise = callbacks
        .onManualCodeInput()
        .then((input) => {
          manualCode = input;
          server.cancelWait();
        })
        .catch((err) => {
          manualError = err instanceof Error ? err : new Error(String(err));
          server.cancelWait();
        });

      const result = await server.waitForCode();
      if (manualError) throw manualError;

      if (result) {
        code = result;
      } else if (manualCode) {
        const parsed = parseAuthorizationInput(manualCode);
        if (parsed.state && parsed.state !== state) {
          throw new Error("State mismatch in manual code input.");
        }
        code = parsed.code;
      }

      if (!code) {
        await manualPromise;
        if (manualError) throw manualError;
        if (manualCode) {
          const parsed = parseAuthorizationInput(manualCode);
          if (parsed.state && parsed.state !== state) {
            throw new Error("State mismatch in manual code input.");
          }
          code = parsed.code;
        }
      }
    } else {
      const result = await server.waitForCode();
      if (result) {
        code = result;
      }
    }

    if (!code) {
      const input = await callbacks.onPrompt({
        message: "Paste the authorization code or redirect URL from xAI:",
      });
      const parsed = parseAuthorizationInput(input);
      if (parsed.state && parsed.state !== state) {
        throw new Error("State mismatch in manual authorization input.");
      }
      code = parsed.code;
    }

    if (!code) {
      throw new Error("Missing authorization code for xAI Grok login.");
    }

    const tokenResult = await exchangeAuthorizationCode(code, verifier, server.redirectUri);
    const accountId = await fetchAccountId(tokenResult.accessToken);

    return {
      access: tokenResult.accessToken,
      refresh: tokenResult.refreshToken,
      expires: Date.now() + tokenResult.expiresIn * 1000,
      accountId,
    };
  } finally {
    server.close();
  }
}

export function syncGrokAuthFromFx(authStorage: AuthStorage): boolean {
  try {
    if (authStorage.hasAuth("xai")) return false;
    const userHome = process.env.HOME || homedir();
    const fxGrokAuthPath = path.join(userHome, ".fx", "grok-auth.json");
    if (!existsSync(fxGrokAuthPath)) return false;
    const raw = readFileSync(fxGrokAuthPath, "utf-8");
    const session = JSON.parse(raw) as {
      access_token?: string;
      refresh_token?: string;
      expires_at_ms?: number;
      account_id?: string;
    };
    if (session?.access_token && session.expires_at_ms && session.expires_at_ms > Date.now()) {
      authStorage.set("xai", {
        type: "oauth",
        access: session.access_token,
        refresh: session.refresh_token || "",
        expires: session.expires_at_ms,
        accountId: session.account_id || "xai-account",
      });
      return true;
    }
  } catch {
    // non-fatal fallback
  }
  return false;
}

export function syncGrokAuthToFx(credentials: OAuthCredentials): void {
  try {
    const userHome = process.env.HOME || homedir();
    const fxDir = path.join(userHome, ".fx");
    if (!existsSync(fxDir)) {
      mkdirSync(fxDir, { recursive: true, mode: 0o700 });
    }
    const fxGrokAuthPath = path.join(fxDir, "grok-auth.json");
    const session = {
      version: 1,
      access_token: credentials.access,
      refresh_token: credentials.refresh,
      expires_at_ms: credentials.expires,
      account_id: credentials.accountId || "xai-account",
    };
    writeFileSync(fxGrokAuthPath, JSON.stringify(session, null, 2) + "\n", { mode: 0o600 });
  } catch {
    // non-fatal
  }
}

export const grokOAuthProvider: OAuthProviderInterface = {
  id: "xai",
  name: "xAI Grok",
  usesCallbackServer: true,
  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const credentials = await loginGrok(callbacks);
    syncGrokAuthToFx(credentials);
    return credentials;
  },
  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    const refreshed = await refreshGrokToken(credentials);
    syncGrokAuthToFx(refreshed);
    return refreshed;
  },
  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
  modifyModels(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[] {
    if (credentials.baseUrl && typeof credentials.baseUrl === "string") {
      const baseUrl = credentials.baseUrl.trim();
      return models.map((m) => (m.provider === "xai" ? { ...m, baseUrl } : m));
    }
    return models;
  },
};

export function registerGrokOAuthProvider(): void {
  registerOAuthProvider(grokOAuthProvider);
}

// Auto-register on module evaluation
registerGrokOAuthProvider();
