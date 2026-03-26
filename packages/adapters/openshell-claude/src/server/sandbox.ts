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

  const defaultImage = "ghcr.io/nvidia/openshell-community/sandboxes/base:latest";
  const sandboxImage = typeof config.sandboxImage === "string" ? config.sandboxImage : defaultImage;
  const policyConfig = parseObject(config.policy);

  const spec: Record<string, unknown> = {
    logLevel: "info",
    template: {
      image: sandboxImage,
      environment: {},
    },
    providers,
    environment: {},
    gpu: false,
  };

  spec.policy = buildSandboxPolicy(policyConfig);

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
  const network = parseObject(policyConfig.network);
  const filesystem = parseObject(policyConfig.filesystem);

  return {
    version: 1,
    filesystem: {
      includeWorkdir: true,
      readOnly: Array.isArray(filesystem.readOnly)
        ? filesystem.readOnly
        : ["/usr", "/lib", "/etc", "/proc", "/dev/urandom"],
      readWrite: Array.isArray(filesystem.readWrite)
        ? filesystem.readWrite
        : ["/sandbox", "/tmp", "/dev/null"],
    },
    landlock: { compatibility: "best_effort" },
    process: { runAsUser: "sandbox", runAsGroup: "sandbox" },
    networkPolicies: Object.keys(network).length > 0
      ? network
      : {
          claude_code: {
            name: "claude-code",
            endpoints: [
              { host: "api.anthropic.com", port: 443, ports: [443], protocol: "rest", tls: "terminate", enforcement: "enforce", access: "full", rules: [], allowedIps: [] },
              { host: "statsig.anthropic.com", port: 443, ports: [443], protocol: "", tls: "", enforcement: "", access: "", rules: [], allowedIps: [] },
              { host: "sentry.io", port: 443, ports: [443], protocol: "", tls: "", enforcement: "", access: "", rules: [], allowedIps: [] },
            ],
            binaries: [
              { path: "/usr/local/bin/claude", harness: false },
              { path: "/usr/bin/node", harness: false },
            ],
          },
        },
  };
}
