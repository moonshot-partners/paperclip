import type {
  AdapterEnvironmentTestResult,
  AdapterEnvironmentCheck,
} from "@paperclipai/adapter-utils";
import { asString, asBoolean } from "@paperclipai/adapter-utils/server-utils";
import { OpenShellClient } from "openshell-node";

export async function testEnvironment(ctx: {
  adapterType: string;
  config: Record<string, unknown>;
}): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const gatewayUrl = asString(ctx.config.gatewayUrl, "127.0.0.1:8080");
  const insecure = asBoolean(ctx.config.insecure, false);
  const cluster = asString(ctx.config.gatewayCluster, "openshell");

  // Check 1: Can we connect to the OpenShell gateway?
  try {
    const client = new OpenShellClient({ gateway: gatewayUrl, cluster, insecure });
    const health = await client.health();
    client.close();

    if (health.status === "SERVICE_STATUS_HEALTHY") {
      checks.push({
        code: "gateway_healthy",
        level: "info",
        message: `OpenShell gateway at ${gatewayUrl} is healthy`,
      });
    } else {
      checks.push({
        code: "gateway_degraded",
        level: "warn",
        message: `OpenShell gateway at ${gatewayUrl} reports status: ${health.status}`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({
      code: "gateway_unreachable",
      level: "error",
      message: `Cannot connect to OpenShell gateway at ${gatewayUrl}`,
      detail: message,
      hint: "Ensure OpenShell gateway is running: openshell gateway start",
    });

    return {
      adapterType: ctx.adapterType,
      status: "fail",
      checks,
      testedAt: new Date().toISOString(),
    };
  }

  const hasWarns = checks.some((c) => c.level === "warn");

  return {
    adapterType: ctx.adapterType,
    status: hasWarns ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}
