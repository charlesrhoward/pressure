import type { CliOptions } from "../types/domain.ts";
import { parseDuration } from "./format.ts";

const COMMANDS = new Set(["snapshot", "diff", "report", "monitor"]);

export function parseCliArgs(argv: string[]): CliOptions {
  let cursor = 0;
  let command: CliOptions["command"] = "tui";

  if (argv[0] && COMMANDS.has(argv[0])) {
    command = argv[0] as CliOptions["command"];
    cursor = 1;
  }

  const options: CliOptions = {
    command,
    sampleMs: 1000,
    format: "markdown",
    mock: false,
    help: false,
  };

  while (cursor < argv.length) {
    const token = argv[cursor];

    switch (token) {
      case "--app":
        options.app = takeValue(argv, ++cursor, token);
        break;
      case "--pid":
        options.pid = Number(takeValue(argv, ++cursor, token));
        break;
      case "--sample":
        options.sampleMs = Number(takeValue(argv, ++cursor, token));
        break;
      case "--record":
        options.recordDurationMs = parseDuration(takeValue(argv, ++cursor, token));
        break;
      case "--export":
        options.exportPath = takeValue(argv, ++cursor, token);
        break;
      case "--output":
        options.outputPath = takeValue(argv, ++cursor, token);
        break;
      case "--before":
        options.beforePath = takeValue(argv, ++cursor, token);
        break;
      case "--after":
        options.afterPath = takeValue(argv, ++cursor, token);
        break;
      case "--format":
        options.format = takeValue(argv, ++cursor, token) as CliOptions["format"];
        break;
      case "--mock":
        options.mock = true;
        break;
      case "--live":
        options.mock = false;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }

    cursor += 1;
  }

  if (Number.isNaN(options.pid)) {
    throw new Error("`--pid` must be a number.");
  }

  if (!Number.isFinite(options.sampleMs) || options.sampleMs <= 0) {
    throw new Error("`--sample` must be a positive number of milliseconds.");
  }

  if (!["markdown", "json", "text"].includes(options.format)) {
    throw new Error("`--format` must be one of: markdown, json, text.");
  }

  return options;
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`Expected a value after ${flag}.`);
  }
  return value;
}

export function buildUsage(): string {
  return [
    "Pressure",
    "",
    "Usage:",
    "  pressure",
    '  pressure --app "Cursor"',
    "  pressure --pid 8421",
    "  pressure --sample 1000 --record 20m --export report.md",
    "  pressure snapshot --pid 8421 --output pressure-snapshot.json",
    "  pressure diff --before before.json --after after.json",
    "  pressure report --pid 8421 --record 30s --format markdown --output report.md",
    "  pressure monitor --pid 8421 --record 10m --output leak-trace.csv",
    "",
    "Flags:",
    "  --app <name>       Preselect an app/process group",
    "  --pid <pid>        Target a specific PID",
    "  --sample <ms>      Sampling interval in milliseconds",
    "  --record <span>    Recording window like 30s, 10m, 1h",
    "  --export <path>    Default export path for the TUI",
    "  --output <path>    Output path for report/monitor/snapshot/diff commands",
    "  --before <path>    Snapshot path for diff",
    "  --after <path>     Snapshot path for diff",
    "  --format <type>    markdown | json | text",
    "  --mock             Force mock collector mode",
    "  --live             Force live collector mode",
    "  --help             Show this help",
  ].join("\n");
}
