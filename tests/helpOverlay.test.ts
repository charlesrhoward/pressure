import { describe, expect, test } from "bun:test";
import { buildHelpDefinitions } from "../src/ui/App.ts";

describe("help overlay definitions", () => {
  test("explains panels and diagnosis terms instead of only listing shortcuts", () => {
    const lines = buildHelpDefinitions();
    const text = lines.join("\n");

    expect(text).toContain("Diagnosis: risk model");
    expect(text).toContain("Verdict:");
    expect(text).toContain("Risk: 0-100");
    expect(text).toContain("Private memory:");
    expect(lines.length).toBeLessThanOrEqual(20);
  });
});
