import type { OpenShellClient, SandboxModel } from "openshell-node";
import { parseObject } from "@paperclipai/adapter-utils/server-utils";

/**
 * Get an existing sandbox by name (persistent mode) or create a new one.
 * In ephemeral mode, skips the lookup and creates directly.
 */
export async function getOrCreateSandbox(
  client: OpenShellClient,
  name: string,
  config: Record<string, unknown>,
  providers: string[],
  persistent: boolean,
): Promise<SandboxModel> {
  if (persistent) {
    try {
      return await client.getSandbox(name);
    } catch {
      // Not found — fall through to create
    }
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

  if (Object.keys(policyConfig).length > 0) {
    spec.policy = buildSandboxPolicy(policyConfig);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- spec built dynamically from config
  return await client.createSandbox({ name, spec } as any);
}

/**
 * Delete a sandbox, ignoring errors (e.g. already deleted or never created).
 */
export async function deleteSandboxSafe(client: OpenShellClient, name: string): Promise<void> {
  try {
    await client.deleteSandbox(name);
  } catch {
    // Sandbox may already be gone — ignore
  }
}

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
