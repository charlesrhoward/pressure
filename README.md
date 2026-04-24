# Pressure

[![License: MIT](https://img.shields.io/badge/license-MIT-34d399.svg)](./LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-111827?logo=apple)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-F9F1E1?logo=bun)
![UI: OpenTUI](https://img.shields.io/badge/ui-OpenTUI-06b6d4)
![Status: Early Prototype](https://img.shields.io/badge/status-early%20prototype-f59e0b)

Terminal-native memory investigation for macOS apps.

Pressure is an open-source tool for developers debugging suspicious app growth, runaway helpers, swap pressure, and possible leaks from the terminal.

Pressure is careful about its claims. It does not try to prove memory corruption or a confirmed leak from lightweight sampling alone.

It is built around a practical set of questions:

- Is this app or process tree growing?
- Which process is growing fastest?
- Is the system starting to compress memory or swap?
- What data should I export for a bug report or deeper investigation?

## Current Scope

Pressure currently ships as a Bun + OpenTUI terminal app with a live macOS collector and a mock-data mode for UI development.

Available workflows:

- Full-screen TUI process explorer
- Headless monitor recordings to CSV
- Headless report export to Markdown, text, or JSON
- Manual `vmmap` snapshots
- Snapshot diffs

## Who It Is For

- macOS app developers
- Electron, Tauri, and desktop tooling teams
- QA engineers reproducing leak reports
- Support engineers collecting diagnostics
- Power users debugging heavy apps like editors, browsers, chat clients, and design tools

## Status

This is an early OSS prototype. The UI and command surface are real, but some metrics are still heuristic:

- Private memory is currently estimated in the lightweight collector path
- `vmmap` is manual, not continuous
- Permissions and macOS process visibility can affect what can be inspected
- The collector is macOS-specific today

## Install

Requirements:

- macOS
- Bun
- Zig

Run without installing globally:

```bash
bunx @charlesrhoward/pressure
```

Or install the CLI globally:

```bash
bun add -g @charlesrhoward/pressure
pressure
```

From a source checkout:

```bash
bun install
```

Run the mock UI:

```bash
bun run dev
```

Run the live app:

```bash
bun run start
```

## Quick Start

Launch the TUI and pick a target from the process explorer:

```bash
bun run start
```

Preselect a target app or PID:

```bash
bun run start -- --app "Cursor"
bun run start -- --pid 8421
```

Record a Markdown report for a reproduction window:

```bash
bun run start -- report --pid 8421 --record 30s --format markdown --output report.md
```

Record a CSV trace for leak debugging:

```bash
bun run start -- monitor --pid 8421 --record 10m --sample 1000 --output /tmp/app-leak-trace.csv
```

Capture snapshots and compare them:

```bash
bun run start -- snapshot --pid 8421 --output before.json
bun run start -- snapshot --pid 8421 --output after.json
bun run start -- diff --before before.json --after after.json --output diff.md
```

## CLI Overview

Core commands:

- `pressure`
- `pressure snapshot`
- `pressure diff`
- `pressure report`
- `pressure monitor`

Key flags:

- `--app <name>`: preselect an app or process group
- `--pid <pid>`: target a specific PID
- `--sample <ms>`: sampling interval in milliseconds
- `--record <span>`: recording window like `30s`, `5m`, `1h`
- `--output <path>`: output path for report, monitor, snapshot, or diff
- `--mock`: force mock collector mode
- `--live`: force live collector mode

Full command reference:

- [docs/cli.md](./docs/cli.md)
- [docs/README.md](./docs/README.md)

## TUI Overview

The main UI is organized around a few ideas:

- A hierarchical process explorer on the left
- Live trend and diagnosis panels in the center and right
- Drilldown rows for the selected group
- Export and snapshot actions from the keyboard

Keyboard shortcuts:

- `q`: quit
- `/`: search the process explorer
- `up/down`: move through rows
- `left/right`: collapse or expand app groups
- `space`: toggle expansion
- `enter`: select the focused row
- `s`: capture a snapshot
- `r`: start or stop a recording window
- `i`: run an idle test
- `d`: toggle diff view
- `e`: export a report
- `?`: toggle help

## Leak Debugging Workflow

For a practical memory-leak investigation:

1. Pick the app or exact child process you care about.
2. Reproduce the suspect behavior.
3. Run `monitor` for a fixed window and save a CSV.
4. Capture `vmmap` snapshots before and after the reproduction.
5. Export a Markdown report with the same target.

The CSV export is intentionally raw and analysis-friendly. Each row contains:

- timestamp
- focused process memory and CPU
- group totals
- system pressure fields
- compressed memory
- swap used
- child-process summaries

More on this workflow:

- [docs/monitoring.md](./docs/monitoring.md)

## Architecture

Pressure is split into collector, analyzer, store, reporting, and UI layers.

- `src/collector`: process discovery, lightweight system metrics, `vmmap`
- `src/analyzer`: suspicion scoring and diagnosis language
- `src/store`: rolling in-memory time-series state
- `src/report`: Markdown, text, JSON, and CSV export
- `src/ui`: OpenTUI dashboard

Architecture notes:

- [docs/architecture.md](./docs/architecture.md)

## Limitations

- macOS only for the live collector path
- `vmmap` can fail for processes the current user cannot inspect
- The lightweight collector uses heuristics where macOS does not expose a cheap exact metric
- Pressure is diagnostic tooling, not proof of a confirmed leak

## Contributing

Pressure is intended to be developed in the open.

- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security policy: [SECURITY.md](./SECURITY.md)

## Project Layout

- `src/index.ts`: CLI entrypoint and headless commands
- `src/collector/processes.ts`: macOS process grouping
- `src/collector/memory.ts`: lightweight process and system sampling
- `src/collector/vmmap.ts`: manual deep snapshots and diffs
- `src/analyzer/risk.ts`: suspicion scoring and diagnosis
- `src/store/timeseries.ts`: rolling in-memory history
- `src/report/markdown.ts`: Markdown, text, and JSON report export
- `src/report/csv.ts`: time-series CSV monitor export
- `src/ui/App.ts`: OpenTUI dashboard
