import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export function buildOpenShellSandboxConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.url) ac.gatewayUrl = v.url;
  ac.timeoutSec = 3600;
  ac.sandboxTimeoutSec = 60;
  ac.dangerouslySkipPermissions = true;
  return ac;
}
