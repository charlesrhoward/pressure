# Monitoring and Leak Workflows

Pressure is most useful when you treat it as evidence collection, not as a leak oracle.

## Goal

You are trying to answer:

- what is growing
- how fast it is growing
- whether it recovers after idle
- whether the growth is isolated to a child process
- whether the system starts compressing memory or swapping

## Fast Workflow

Use this when you already know the suspect target:

1. Identify the app or exact PID you care about.
2. Start a CSV trace with `pressure monitor`.
3. Reproduce the issue.
4. Stop after a fixed window.
5. Capture snapshots around the reproduction if you need deeper evidence.

Example:

```bash
pressure monitor --pid 8421 --record 10m --sample 1000 --output /tmp/cursor-leak.csv
```

## Compare App vs Child Process

If an Electron-style app has many helpers, it is usually better to inspect the child that is growing fastest.

Two useful patterns:

```bash
pressure monitor --app "Cursor" --record 5m --output cursor-group.csv
pressure monitor --pid 8423 --record 5m --output cursor-renderer.csv
```

The first gives you group totals. The second gives you a focused child-process trace in the `focus_*` columns.

## Pair CSV With Reports

CSV is best for analysis. Reports are best for communication.

Recommended pairing:

```bash
pressure monitor --pid 8423 --record 5m --output renderer.csv
pressure report --pid 8423 --record 30s --format markdown --output renderer-report.md
```

Use the report in the issue thread. Use the CSV for charts, regression tracking, or spreadsheet analysis.

## Pair CSV With Snapshots

Use snapshots when the question shifts from:

> Is this process growing?

to:

> Which memory region or class of allocation appears to be growing?

Example:

```bash
pressure snapshot --pid 8423 --output before.json
pressure monitor --pid 8423 --record 2m --output trace.csv
pressure snapshot --pid 8423 --output after.json
pressure diff --before before.json --after after.json --output diff.md
```

## What The CSV Contains

Each row includes:

- timestamp
- target group identity
- focused process identity
- focused process RSS, private estimate, CPU, runtime
- group total RSS and private estimate
- system pressure score and level
- system compressed memory and swap
- child count and total child RSS
- top child process
- a serialized child summary column

## Limitations

- Lightweight private-memory values are still heuristic
- `vmmap` is manual and separate from CSV tracing
- A growing RSS line is evidence of suspicious growth, not proof of a confirmed leak
