import { join, resolve } from "node:path";
import { AuthStorage, ModelRegistry, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { RuntimeSupervisorOptions } from "./runtime-supervisor.js";
import { registerGrokOAuthProvider, syncGrokAuthFromFx } from "./grok-oauth-provider.js";

export interface RuntimeDependencies {
  readonly agentDir: string;
  readonly authStorage: AuthStorage;
  readonly modelRegistry: ModelRegistry;
}

export function createRuntimeDependencies(options: RuntimeSupervisorOptions = {}): RuntimeDependencies {
  registerGrokOAuthProvider();
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  const authStorage = options.authStorage ?? AuthStorage.create(join(agentDir, "auth.json"));
  syncGrokAuthFromFx(authStorage);
  const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  return {
    agentDir,
    authStorage,
    modelRegistry,
  };
}
