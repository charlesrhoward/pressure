# Security Policy

Pressure is a local developer tool and currently targets macOS process inspection workflows.

## Supported Scope

Security issues are especially relevant when they involve:

- unsafe command execution
- path traversal in exports
- accidental data disclosure in reports or CSV exports
- privilege escalation assumptions around process inspection
- parsing bugs that lead to unsafe shell behavior

## What To Expect

Pressure does not currently ship a hosted service or managed backend. Most security concerns will be local execution or local data-handling issues.

## Reporting

If you find a security issue, please do not open a public issue with exploit details first.

Instead, report it privately to the project maintainers through the contact path they publish for this repository. Include:

- affected command or workflow
- reproduction steps
- impact
- any proposed mitigation

## Safe Defaults

Pressure should continue to follow a few principles:

- only shell out to explicit local macOS tools
- fail gracefully when a process cannot be inspected
- never over-assume permissions
- keep exports explicit and path-based
