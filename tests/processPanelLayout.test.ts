import { describe, expect, test } from "bun:test";
import { calculateProcessViewportRows } from "../src/ui/App.ts";

describe("process explorer viewport rows", () => {
  test("reserves panel chrome and the search row before listing processes", () => {
    expect(calculateProcessViewportRows(12)).toBe(7);
  });

  test("keeps at least one process row for short panels", () => {
    expect(calculateProcessViewportRows(5)).toBe(1);
    expect(calculateProcessViewportRows(0)).toBe(1);
  });
});
