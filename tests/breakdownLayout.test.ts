import { describe, expect, test } from "bun:test";
import { formatBreakdownTableRow } from "../src/ui/App.ts";

function columnStart(row: string, value: string): number {
  return row.indexOf(value);
}

describe("process drilldown table layout", () => {
  test("aligns aggregate rows with process row columns", () => {
    const processRow = formatBreakdownTableRow("main Codex main", "424.2 MB", "0%", "42:04:31");
    const groupRow = formatBreakdownTableRow("Group total", "7.1 GB", "0%", "42:04:31");
    const privateRow = formatBreakdownTableRow("Private memory", "n/a", "n/a", "vmmap needed");

    expect(columnStart(groupRow, "7.1 GB")).toBe(columnStart(processRow, "424.2 MB"));
    expect(columnStart(privateRow, "n/a")).toBe(columnStart(processRow, "424.2 MB"));
    expect(columnStart(groupRow, "0%")).toBe(columnStart(processRow, "0%"));
    expect(columnStart(privateRow, "vmmap needed")).toBe(columnStart(processRow, "42:04:31"));
  });
});
