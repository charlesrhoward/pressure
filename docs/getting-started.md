# Getting Started

This guide covers both the published Bun package and running Pressure from source.

## Requirements

- macOS
- Bun
- Zig

Pressure uses OpenTUI for the terminal UI, and the current dependency surface is Bun-first.

## Install

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

## First Run

Start with mock mode to verify the UI works:

```bash
bun run dev
```

Then run the live collector:

```bash
bun run start
```

## Select a Target

You can open the TUI with no target and pick one interactively:

```bash
bun run start
```

Or preselect by app name:

```bash
bun run start -- --app "Cursor"
```

Or by PID:

```bash
bun run start -- --pid 8421
```

## First Useful Exports

Create a quick report:

```bash
bun run start -- report --pid 8421 --record 30s --output report.md
```

Create a CSV trace:

```bash
bun run start -- monitor --pid 8421 --record 5m --sample 1000 --output trace.csv
```

Capture snapshots:

```bash
bun run start -- snapshot --pid 8421 --output before.json
bun run start -- snapshot --pid 8421 --output after.json
```

Diff them:

```bash
bun run start -- diff --before before.json --after after.json --output diff.md
```

## When To Use Which Export

- Use `monitor` when you need raw timeseries data for plotting or regression checks.
- Use `report` when you need a human-readable summary for a bug thread or issue.
- Use `snapshot` and `diff` when you need deeper evidence about which memory regions changed.

## Common Gotchas

- Some processes will not allow `vmmap` inspection without additional privileges.
- The live process list depends on what the current user can see.
- Lightweight private-memory values are currently estimates, not exact kernel-provided counters.
