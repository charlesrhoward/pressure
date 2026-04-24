# Architecture

Pressure is organized around a small number of runtime layers.

## 1. Collector Layer

Files:

- `src/collector/processes.ts`
- `src/collector/memory.ts`
- `src/collector/vmmap.ts`
- `src/collector/mock.ts`

Responsibilities:

- discover running processes
- group helpers under a likely owning app
- sample lightweight process and system metrics
- capture manual `vmmap` snapshots
- provide a mock collector for UI work

The live collector currently relies on:

- `ps`
- `vm_stat`
- `sysctl`
- `vmmap`

## 2. Store Layer

File:

- `src/store/timeseries.ts`

Responsibilities:

- hold rolling in-memory samples
- retain recent history for trend analysis
- retain recent `vmmap` snapshots
- produce the latest snapshot diff

## 3. Analyzer Layer

File:

- `src/analyzer/risk.ts`

Responsibilities:

- compute suspicion score
- classify risk level
- produce diagnosis language
- suggest next actions

This layer is deliberately evidence-first. It can flag suspicious growth, but it does not try to overclaim a confirmed leak from lightweight sampling alone.

## 4. Reporting Layer

Files:

- `src/report/markdown.ts`
- `src/report/csv.ts`

Responsibilities:

- human-readable reports for issues and support threads
- raw CSV exports for leak-debugging analysis
- snapshot diff rendering

## 5. UI Layer

File:

- `src/ui/App.ts`

Responsibilities:

- render the OpenTUI dashboard
- manage process explorer state
- manage drilldowns and selection
- trigger snapshots and report export

## Data Model Notes

There are two levels of process identity in the app:

- group-level metrics for the whole app tree
- process-level metrics for the exact focused root or child process

This distinction matters for memory-leak debugging. A child process can grow badly while the app-group total hides which child is responsible.

## Design Principle

Pressure should bias toward:

- reliable lightweight collection
- explicit caveats
- useful exports
- evidence over vibes
