import type { OpenShellClient } from "openshell-node";
import { parseObject } from "@paperclipai/adapter-utils/server-utils";

interface SandboxModel {
  id: string;
  name: string;
  phase: number;
}

/**
 * Get an existing sandbox by name or create a new one.
 * Used for persistent sandboxes that survive across heartbeats.
 */
export async function getOrCreateSandbox(
  client: OpenShellClient,
  name: string,
  config: Record<string, unknown>,
  providers: string[],
): Promise<SandboxModel> {
  // Try to find an existing sandbox with this name
  try {
    const existing = await client.getSandbox(name);
    return existing as SandboxModel;
  } catch {
    // Not found — create a new one
  }

  const sandboxImage = typeof config.sandboxImage === "string" ? config.sandboxImage : undefined;
  const policyConfig = parseObject(config.policy);

  const spec: Record<string, unknown> = {
    logLevel: "info",
    template: {
      image: sandboxImage ?? "",
      environment: {},
    },
    providers,
    environment: {},
    gpu: false,
  };

  // Apply security policy if configured
  if (Object.keys(policyConfig).length > 0) {
    spec.policy = buildSandboxPolicy(policyConfig);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- spec shape matches proto but types are strict
  const sandbox = await client.createSandbox({ name, spec } as any);
  return sandbox as SandboxModel;
}

/**
 * Delete a sandbox, ignoring errors (e.g. already deleted).
 */
export async function deleteSandboxSafe(client: OpenShellClient, name: string): Promise<void> {
  try {
    await client.deleteSandbox(name);
  } catch {
    // Sandbox may already be gone — ignore
  }
}

/**
 * Build an OpenShell SandboxPolicy from adapter config.
 */
function buildSandboxPolicy(policyConfig: Record<string, unknown>): Record<string, unknown> {
  const policy: Record<string, unknown> = { version: 1 };

  const network = parseObject(policyConfig.network);
  if (Object.keys(network).length > 0) {
    policy.networkPolicies = network;
  }

  const filesystem = parseObject(policyConfig.filesystem);
  if (Object.keys(filesystem).length > 0) {
    policy.filesystem = {
      includeWorkdir: true,
      readOnly: Array.isArray(filesystem.readOnly) ? filesystem.readOnly : [],
      readWrite: Array.isArray(filesystem.readWrite) ? filesystem.readWrite : [],
    };
  }

  return policy;
}
