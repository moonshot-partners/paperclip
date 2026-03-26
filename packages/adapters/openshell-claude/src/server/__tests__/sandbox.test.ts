import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClient = {
  getSandbox: vi.fn(),
  createSandbox: vi.fn(),
  deleteSandbox: vi.fn(),
};

import { getOrCreateSandbox, deleteSandboxSafe } from "../sandbox.js";

// Cast to OpenShellClient interface
const client = mockClient as unknown as Parameters<typeof getOrCreateSandbox>[0];

describe("getOrCreateSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new sandbox in ephemeral mode (skips getSandbox)", async () => {
    mockClient.createSandbox.mockResolvedValue({ id: "sb-new", name: "test-sb", phase: 2 });

    const result = await getOrCreateSandbox(client, "test-sb", {}, [], false);

    expect(mockClient.getSandbox).not.toHaveBeenCalled();
    expect(mockClient.createSandbox).toHaveBeenCalledOnce();
    expect(result.name).toBe("test-sb");
  });

  it("looks up existing sandbox in persistent mode", async () => {
    mockClient.getSandbox.mockResolvedValue({ id: "sb-existing", name: "test-sb", phase: 2 });

    const result = await getOrCreateSandbox(client, "test-sb", {}, [], true);

    expect(mockClient.getSandbox).toHaveBeenCalledOnce();
    expect(mockClient.createSandbox).not.toHaveBeenCalled();
    expect(result.id).toBe("sb-existing");
  });

  it("creates sandbox if persistent lookup fails", async () => {
    mockClient.getSandbox.mockRejectedValue(new Error("not found"));
    mockClient.createSandbox.mockResolvedValue({ id: "sb-new", name: "test-sb", phase: 2 });

    const result = await getOrCreateSandbox(client, "test-sb", {}, [], true);

    expect(mockClient.getSandbox).toHaveBeenCalledOnce();
    expect(mockClient.createSandbox).toHaveBeenCalledOnce();
    expect(result.id).toBe("sb-new");
  });

  it("passes providers to createSandbox", async () => {
    mockClient.createSandbox.mockResolvedValue({ id: "sb-1", name: "test", phase: 2 });

    await getOrCreateSandbox(client, "test", {}, ["claude-key", "slack-token"], false);

    const call = mockClient.createSandbox.mock.calls[0][0];
    expect(call.spec.providers).toEqual(["claude-key", "slack-token"]);
  });

  it("applies policy config when provided", async () => {
    mockClient.createSandbox.mockResolvedValue({ id: "sb-1", name: "test", phase: 2 });

    const config = {
      policy: {
        network: { claude_api: { endpoints: [{ host: "api.anthropic.com" }] } },
        filesystem: { readOnly: ["/workspace"], readWrite: ["/tmp"] },
      },
    };

    await getOrCreateSandbox(client, "test", config, [], false);

    const call = mockClient.createSandbox.mock.calls[0][0];
    expect(call.spec.policy).toBeDefined();
    expect(call.spec.policy.networkPolicies).toBeDefined();
    expect(call.spec.policy.filesystem.readOnly).toEqual(["/workspace"]);
    expect(call.spec.policy.filesystem.readWrite).toEqual(["/tmp"]);
  });
});

describe("deleteSandboxSafe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes sandbox by name", async () => {
    mockClient.deleteSandbox.mockResolvedValue(undefined);
    await deleteSandboxSafe(client, "test-sb");
    expect(mockClient.deleteSandbox).toHaveBeenCalledWith("test-sb");
  });

  it("silently ignores errors", async () => {
    mockClient.deleteSandbox.mockRejectedValue(new Error("not found"));
    await expect(deleteSandboxSafe(client, "missing-sb")).resolves.toBeUndefined();
  });
});
