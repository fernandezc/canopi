# Workflow

The tracker's commands and triage labels. The rules are in [`AGENTS.md`](../AGENTS.md); places, gates and who writes `bd` are in [agentic delivery](guides/agentic-delivery.md); the delivery procedure is the user-level `phased-agentic-delivery` skill.

## Beads (bd)

bd tracks user-visible work, bugs, epics and decisions; sub-steps of one bead stay in the agent's head. `bd prime` prints the command reference.

```bash
bd ready                                   # dependencies clear
bd show <id>
bd update <id> --claim
bd create --title "<title>" --description "<problem>" --type=task --priority=2
bd dep add <issue> <depends-on>
bd search "<concept>" --type decision --status all
bd close <id> --reason="<what shipped, commits, gates>"
bd export -o .beads/issues.jsonl            # then commit the file
```

- `description` holds the problem, `design` the brief, `acceptance` the observable checklist.
- `--notes` replaces; `--append-notes` adds.
- `decision` beads hold scope and rejection memory; search them before proposing again.
- Bead changes update Dolt, not the tracked snapshot: export and commit `.beads/issues.jsonl` with the change.

## Triage

An open bead carries a release label (`2.1`, `later`), which stands in for triage, or one readiness label: `needs-info`, `ready-for-agent` (outcome clear, acceptance observable, blockers as dependencies, no open product or policy decision) or `ready-for-human`. `needs-triage` marks only a new bead with no release label yet. `wontfix` closes it. `in_progress` means claimed, not triaged. Change a label in two calls (remove, then add) and verify.
