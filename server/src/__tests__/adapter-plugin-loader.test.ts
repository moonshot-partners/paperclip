import { describe, it, expect } from "vitest";
import { loadExternalAdapters, findServerAdapter } from "../adapters/registry.js";

describe("loadExternalAdapters", () => {
  it("gracefully handles missing packages without crashing", async () => {
    // Should not throw — graceful degradation
    await expect(loadExternalAdapters(["nonexistent-adapter-xyz"])).resolves.toBeUndefined();
  });

  it("continues loading after one package fails", async () => {
    await expect(loadExternalAdapters(["bad-pkg-1", "bad-pkg-2"])).resolves.toBeUndefined();
  });

  it("does not register anything for missing packages", async () => {
    await loadExternalAdapters(["nonexistent-package-abc"]);
    expect(findServerAdapter("nonexistent_package_abc")).toBeNull();
  });

  it("findServerAdapter returns null for unregistered types", () => {
    expect(findServerAdapter("totally_unknown_type")).toBeNull();
  });
});
