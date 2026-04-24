# CLI Reference

Pressure currently supports five top-level entrypoints.

## `pressure`

Launch the OpenTUI dashboard.

Examples:

```bash
pressure
pressure --app "Cursor"
pressure --pid 8421
pressure --sample 1000
```

## `pressure report`

Sample a target for a fixed window and export a report.

Examples:

```bash
pressure report --pid 8421 --record 30s --format markdown --output report.md
pressure report --app "Google Chrome" --record 2m --format text --output chrome.txt
```

Supported formats:

- `markdown`
- `text`
- `json`

## `pressure monitor`

Sample a target for a fixed window and export CSV.

Examples:

```bash
pressure monitor --pid 8421 --record 10m --sample 1000 --output leak-trace.csv
pressure monitor --app "Cursor" --record 5m --sample 500 --output cursor.csv
```

The CSV is intended for debugging and offline analysis. It includes:

- focused process metrics
- app-group totals
- system pressure fields
- compressed memory and swap
- child process summaries

## `pressure snapshot`

Capture a `vmmap` snapshot for a target.

Examples:

```bash
pressure snapshot --pid 8421 --output before.json
pressure snapshot --app "Slack" --output slack.json
```

## `pressure diff`

Compare two snapshot files.

Examples:

```bash
pressure diff --before before.json --after after.json --output diff.md
pressure diff --before before.json --after after.json --format json --output diff.json
```

## Common Flags

- `--app <name>`: target by app or process-group name
- `--pid <pid>`: target by PID
- `--sample <ms>`: sampling interval in milliseconds
- `--record <span>`: time window like `30s`, `5m`, `1h`
- `--output <path>`: path for exported artifacts
- `--mock`: force mock collector mode
- `--live`: force live collector mode
- `--help`: print usage

## TUI Shortcuts

- `q`: quit
- `/`: search process explorer
- `up/down`: move focus
- `left/right`: collapse or expand
- `space`: toggle expansion
- `enter`: select focused row
- `s`: snapshot
- `r`: record toggle
- `i`: idle test
- `d`: diff view
- `e`: export report
- `?`: help
