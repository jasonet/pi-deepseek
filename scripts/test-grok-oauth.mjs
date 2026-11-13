import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOAuthProvider, getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  XAI_CLIENT_ID,
  XAI_SCOPE,
  buildAuthorizationUrl,
  generatePKCE,
  grokOAuthProvider,
  parseAuthorizationInput,
  registerGrokOAuthProvider,
  syncGrokAuthFromFx,
  syncGrokAuthToFx,
  RuntimeSupervisor,
  SessionSupervisor,
} from "../packages/pi-sdk-driver/dist/index.js";

console.log("Running Grok OAuth Integration Tests...");

// Test 1: PKCE Generation
{
  const { verifier, challenge } = generatePKCE();
  assert(verifier, "verifier should be defined");
  assert(challenge, "challenge should be defined");
  assert(verifier.length > 30, "verifier length should be > 30");
  assert(challenge.length > 30, "challenge length should be > 30");
  assert(/^[A-Za-z0-9_-]+$/.test(verifier), "verifier should be base64url");
  assert(/^[A-Za-z0-9_-]+$/.test(challenge), "challenge should be base64url");
  console.log("  ✓ PKCE verifier and challenge generation");
}

// Test 2: Authorization URL
{
  const urlString = buildAuthorizationUrl({
    challenge: "test-challenge-123",
    state: "test-state-456",
    redirectUri: "http://127.0.0.1:1456/callback",
  });
  const url = new URL(urlString);
  assert.equal(url.origin, "https://auth.x.ai");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), XAI_CLIENT_ID);
  assert.equal(url.searchParams.get("scope"), XAI_SCOPE);
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:1456/callback");
  assert.equal(url.searchParams.get("code_challenge"), "test-challenge-123");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "test-state-456");
  assert.equal(url.searchParams.get("referrer"), "fx");
  console.log("  ✓ Authorization URL parameters and scope");
}

// Test 3: Parse Authorization Input
{
  const fromUrl = parseAuthorizationInput("http://127.0.0.1:1456/callback?code=abc123code&state=xyz456state");
  assert.equal(fromUrl.code, "abc123code");
  assert.equal(fromUrl.state, "xyz456state");

  const fromQuery = parseAuthorizationInput("code=my-code-1&state=my-state-2");
  assert.equal(fromQuery.code, "my-code-1");
  assert.equal(fromQuery.state, "my-state-2");

  const fromRaw = parseAuthorizationInput("raw-auth-code-789");
  assert.equal(fromRaw.code, "raw-auth-code-789");
  console.log("  ✓ Authorization input parsing (URL, query, code)");
}

// Test 4: Registry in @earendil-works/pi-ai
{
  registerGrokOAuthProvider();
  const provider = getOAuthProvider("xai");
  assert(provider, "xai oauth provider must be registered");
  assert.equal(provider.id, "xai");
  assert.equal(provider.name, "xAI Grok");
  assert.equal(provider.usesCallbackServer, true);

  const all = getOAuthProviders();
  assert(all.some((p) => p.id === "xai"), "xai must be in getOAuthProviders()");
  console.log("  ✓ Grok OAuth provider registered in pi-ai OAuth registry");
}

// Test 5: RuntimeSupervisor integration & model availability
{
  const tempDir = mkdtempSync(path.join(tmpdir(), "pi-grok-test-"));
  try {
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const supervisor = new RuntimeSupervisor({
      agentDir: tempDir,
      authStorage,
      modelRegistry,
    });

    const snapshotBefore = await supervisor.getRuntimeSnapshot({ id: "ws1", path: tempDir });
    const xaiBefore = snapshotBefore.providers.find((p) => p.id === "xai");
    assert(xaiBefore, "xai provider should be present");
    assert.equal(xaiBefore.oauthSupported, true, "oauthSupported should be true");
    assert.equal(xaiBefore.name, "xAI Grok", "name should be xAI Grok");
    assert.equal(xaiBefore.hasAuth, false, "hasAuth should be false before login");
    assert.equal(xaiBefore.authSource, "none", "authSource should be none before login");

    // All xai models should be unavailable before auth
    const modelsBefore = snapshotBefore.models.filter((m) => m.providerId === "xai");
    assert(modelsBefore.length > 0, "xai models should be in catalog");
    assert(modelsBefore.every((m) => !m.available), "xai models must not be available without auth");

    // Authenticate with Grok OAuth credentials
    authStorage.set("xai", {
      type: "oauth",
      access: "xai-test-access-token",
      refresh: "xai-test-refresh-token",
      expires: Date.now() + 3600 * 1000,
      accountId: "test-grok-user",
    });

    const snapshotAfter = await supervisor.getRuntimeSnapshot({ id: "ws1", path: tempDir });
    const xaiAfter = snapshotAfter.providers.find((p) => p.id === "xai");
    assert.equal(xaiAfter.hasAuth, true, "hasAuth should be true after login");
    assert.equal(xaiAfter.authSource, "oauth", "authSource should be oauth");

    // Models should now be available for Pi development
    const modelsAfter = snapshotAfter.models.filter((m) => m.providerId === "xai");
    assert(modelsAfter.length > 0, "xai models should exist");
    assert(modelsAfter.some((m) => m.available && m.modelId.includes("grok")), "Grok models must be available after auth");
    console.log("  ✓ RuntimeSupervisor snapshot: oauthSupported=true, authSource=oauth, Grok models available");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// Test 6: Model Resolution in SessionSupervisor (both xai and grok provider aliases)
{
  const tempDir = mkdtempSync(path.join(tmpdir(), "pi-session-grok-test-"));
  try {
    const authStorage = AuthStorage.inMemory();
    authStorage.set("xai", {
      type: "oauth",
      access: "test-token",
      refresh: "test-refresh",
      expires: Date.now() + 3600 * 1000,
      accountId: "test-user",
    });
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const sessionSupervisor = new SessionSupervisor({
      agentDir: tempDir,
      authStorage,
      modelRegistry,
    });

    // Both xai/grok-4 and grok/grok-4 should resolve
    const modelXai = sessionSupervisor["resolveModel"]("xai", "grok-4");
    assert(modelXai, "xai/grok-4 must resolve");
    assert.equal(modelXai.id, "grok-4");

    const modelGrok = sessionSupervisor["resolveModel"]("grok", "grok-4");
    assert(modelGrok, "grok/grok-4 must resolve via alias");
    assert.equal(modelGrok.id, "grok-4");
    console.log("  ✓ SessionSupervisor resolveModel: supports both xai:* and grok:*");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// Test 7: Bidirectional fx grok session sync
{
  const tempHome = mkdtempSync(path.join(tmpdir(), "pi-fx-grok-sync-"));
  const fxDir = path.join(tempHome, ".fx");
  mkdirSync(fxDir, { recursive: true });

  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const authStorage = AuthStorage.inMemory();
    assert.equal(authStorage.hasAuth("xai"), false);

    // Write mock fx grok session
    writeFileSync(
      path.join(fxDir, "grok-auth.json"),
      JSON.stringify({
        version: 1,
        access_token: "fx-grok-jwt-token",
        refresh_token: "fx-grok-refresh",
        expires_at_ms: Date.now() + 7200 * 1000,
        account_id: "fx-user-123",
      }),
    );

    const didSync = syncGrokAuthFromFx(authStorage);
    assert.equal(didSync, true, "should sync from fx grok session");
    assert.equal(authStorage.hasAuth("xai"), true, "should have auth for xai");

    const creds = authStorage.get("xai");
    assert.equal(creds.access, "fx-grok-jwt-token");
    assert.equal(creds.refresh, "fx-grok-refresh");

    // Test sync back to fx
    syncGrokAuthToFx({
      access: "new-access-token",
      refresh: "new-refresh-token",
      expires: Date.now() + 100000,
      accountId: "fx-user-123",
    });

    const updatedFx = JSON.parse(
      readFileSync(path.join(fxDir, "grok-auth.json"), "utf8"),
    );
    assert.equal(updatedFx.access_token, "new-access-token");
    assert.equal(updatedFx.refresh_token, "new-refresh-token");
    console.log("  ✓ Bidirectional session sync with ~/.fx/grok-auth.json");
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

console.log("\nALL GROK OAUTH TESTS PASSED! 🎉");
