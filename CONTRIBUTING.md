# Contributing

Pressure is intended to be developed in the open.

## Before You Start

Pressure is currently:

- macOS-first
- Bun-based
- OpenTUI-based
- focused on debugging suspicious growth, not making exaggerated claims

Please keep those constraints in mind when proposing changes.

## Development Setup

Install dependencies:

```bash
bun install
```

Run mock mode:

```bash
bun run dev
```

Run the live app:

```bash
bun run start
```

Typecheck:

```bash
bun run typecheck
```

## Contribution Areas

High-value contributions:

- collector accuracy improvements
- better app and child-process grouping
- better CSV and report exports
- clearer diagnosis language
- test coverage around parsing and analysis
- better `vmmap` parsing
- UI improvements that preserve diagnostic density

## Ground Rules

- Do not make Pressure sound more certain than the evidence supports.
- Prefer source-backed behavior over invented metrics.
- Treat the CSV and report exports as first-class product surfaces.
- Keep macOS permissions and inspection failures graceful.

## Pull Requests

Good PRs usually include:

- the user problem being fixed
- the affected command or UI flow
- example command lines
- verification notes
- screenshots for TUI changes when relevant

## Documentation

If you change:

- command surfaces
- exported fields
- keyboard shortcuts
- report formats
- collector assumptions

then update the relevant docs in:

- `README.md`
- `docs/cli.md`
- `docs/monitoring.md`
- `docs/architecture.md`

## Testing Notes

This repo currently has limited formal test coverage. Until that changes:

- keep verification narrow and task-specific
- prefer concrete repro paths over broad noisy checks
- use mock mode when live macOS inspection is unavailable
