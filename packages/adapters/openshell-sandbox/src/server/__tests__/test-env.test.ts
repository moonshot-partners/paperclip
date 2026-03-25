import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClient = {
  health: vi.fn(),
  close: vi.fn(),
};

vi.mock("openshell-node", () => ({
  OpenShellClient: vi.fn(() => mockClient),
}));

import { testEnvironment } from "../test.js";

describe("openshell-sandbox testEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pass when gateway is healthy", async () => {
    mockClient.health.mockResolvedValue({ status: "SERVICE_STATUS_HEALTHY" });

    const result = await testEnvironment({
      adapterType: "openshell_sandbox",
      config: { gatewayUrl: "127.0.0.1:8080", insecure: true },
    });

    expect(result.status).toBe("pass");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].code).toBe("gateway_healthy");
    expect(mockClient.close).toHaveBeenCalledOnce();
  });

  it("returns warn when gateway is degraded", async () => {
    mockClient.health.mockResolvedValue({ status: "SERVICE_STATUS_DEGRADED" });

    const result = await testEnvironment({
      adapterType: "openshell_sandbox",
      config: { gatewayUrl: "127.0.0.1:8080", insecure: true },
    });

    expect(result.status).toBe("warn");
    expect(result.checks[0].code).toBe("gateway_degraded");
  });

  it("returns fail when gateway is unreachable", async () => {
    mockClient.health.mockRejectedValue(new Error("Connection refused"));

    const result = await testEnvironment({
      adapterType: "openshell_sandbox",
      config: { gatewayUrl: "127.0.0.1:9999", insecure: true },
    });

    expect(result.status).toBe("fail");
    expect(result.checks[0].code).toBe("gateway_unreachable");
    expect(result.checks[0].detail).toBe("Connection refused");
    expect(result.checks[0].hint).toContain("openshell gateway start");
  });
});
