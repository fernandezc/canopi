"""Offline checks for repository Markdown links, ADR status, docs placement, size budgets and decision ledgers.

Checks inline links/images, reference definitions, and Markdown heading fragments.
Fenced code, inline code, and external URLs are excluded. This is intentionally
not a full Markdown renderer or a network/link availability checker.
"""

from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
ADR_STATES = {"proposed", "accepted", "superseded", "rejected", "deprecated"}
LINK = re.compile(r"\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+\"[^\"]*\")?\)")
REFERENCE = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)", re.MULTILINE)
# The v2 documentation layout: anything else under docs/ is evidence or history
# that belongs in bd or nowhere.
DOCS_FILES = {"README.md", "architecture.md", "workflow.md", "review-checklist.md"}
DOCS_DIRECTORIES = {"adr", "decisions", "guides", "plans", "release-notes"}
LINE_BUDGETS = {
    "AGENTS.md": 120,
    "README.md": 80,
    "CONTEXT.md": 250,
    "docs/README.md": 60,
    "docs/architecture.md": 160,
    "docs/workflow.md": 100,
    "docs/review-checklist.md": 200,
}
# A guide states rules and boundaries; wiring lives in code comments and policy
# tests. Budgets in bytes stop the guides from growing by accretion again.
BYTE_BUDGETS = {
    "AGENTS.md": 9_500,
    "CONTEXT.md": 17_000,
    "docs/README.md": 4_000,
    "docs/architecture.md": 12_000,
    "docs/workflow.md": 8_000,
    "docs/review-checklist.md": 12_000,
    "docs/release-notes/v2.0.0.md": 14_000,
    ".interface-design/system.md": 9_000,
}
GUIDE_BYTE_BUDGET = 12_000
PATTERN_BYTE_BUDGET = 8_000
ADR_BUDGET = 60
# One idea per paragraph. Long paragraphs are how file-by-file narration crept
# into the guides; tables and reference definitions are exempt.
PARAGRAPH_BUDGET = 600
# Exempt: release notes, and the ONF adaptation plan, written before the budget
# reached docs/plans, whose long paragraphs are lists of upstream names.
PARAGRAPH_EXEMPT = (
    "docs/release-notes/",
    "docs/plans/onf-plugin-adaptation.md",
)


# A decision ledger (docs/decisions/<release>.md) is the one append-only
# document: each row is a dated user decision and names what implements it.
LEDGER_COLUMNS = ("id", "date", "implemented by")
LEDGER_ID = re.compile(r"^\d+\.\d+-[A-Z]+\d+[a-z]?$")
LEDGER_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# "ADR 0026", and lists such as "ADRs 0022, 0023 and 0030" or "ADRs 0015 to 0020".
ADR_CITATION = re.compile(r"\bADRs? (\d{4}(?:(?:, |,? and | to )\d{4})*)\b")
LEDGER_RELEASE = re.compile(r"^(\d+)-(\d+)$")


def prose(text):
    lines = []
    fence = None
    for line in text.splitlines():
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
            lines.append("")
        elif marker:
            fence = marker[1]
            lines.append("")
        else:
            lines.append(line)
    return "\n".join(lines)


def anchors(text):
    used = set()
    for line in prose(text).splitlines():
        match = re.match(r"^#{1,6}\s+(.+?)(?:\s+#+)?$", line)
        if match:
            slug = re.sub(r"[^\w\- ]", "", match[1].lower()).replace(" ", "-")
            unique, suffix = slug, 0
            while unique in used:
                suffix += 1
                unique = f"{slug}-{suffix}"
            used.add(unique)
    used.update(re.findall(r'<a\s+(?:id|name)=["\']([^"\']+)', text))
    return used


def check_document(file, root):
    text = file.read_text(encoding="utf-8")
    body = prose(text)
    # Backtick-delimited examples are not navigable Markdown links.
    body = re.sub(r"(`+).*?\1", "", body)
    errors = []
    relative = file.relative_to(root).as_posix()
    for match in list(LINK.finditer(body)) + list(REFERENCE.finditer(body)):
        target = match[1].strip("<>")
        url = urlsplit(target)
        if url.scheme or url.netloc:
            continue
        path = unquote(url.path)
        dest = (root / path.lstrip("/") if path.startswith("/") else file.parent / path) if path else file
        line = body[:match.start()].count("\n") + 1
        if not dest.exists():
            errors.append(f"{relative}:{line}: missing target {target}")
        elif url.fragment and dest.suffix == ".md" and unquote(url.fragment) not in anchors(dest.read_text(encoding="utf-8")):
            errors.append(f"{relative}:{line}: missing heading {target}")

    budget = LINE_BUDGETS.get(relative) or (ADR_BUDGET if relative.startswith("docs/adr/") else None)
    lines = len(text.splitlines())
    if budget is not None and lines > budget:
        errors.append(f"{relative}: {lines} lines exceeds its {budget}-line budget")
    byte_budget = BYTE_BUDGETS.get(relative)
    if byte_budget is None and relative.startswith("docs/guides/"):
        byte_budget = GUIDE_BYTE_BUDGET
    if byte_budget is None and relative.startswith(".interface-design/patterns/"):
        byte_budget = PATTERN_BYTE_BUDGET
    size = len(text.encode("utf-8"))
    if byte_budget is not None and size > byte_budget:
        errors.append(f"{relative}: {size} bytes exceeds its {byte_budget}-byte budget")
    if not relative.startswith(PARAGRAPH_EXEMPT):
        for number, line in enumerate(prose(text).splitlines(), start=1):
            if len(line) > PARAGRAPH_BUDGET and not line.lstrip().startswith("|") and not REFERENCE.match(line):
                errors.append(f"{relative}:{number}: paragraph of {len(line)} characters exceeds {PARAGRAPH_BUDGET}")
    if relative.startswith("docs/plans/") and not re.search(r"^Status:\s*\S", text, re.MULTILINE):
        errors.append(f"{relative}: a plan needs a `Status:` line (proposed, agreed, in progress)")
    if relative.startswith("docs/adr/"):
        status = re.search(r"^(?:status|Status):\s*(\w+)", text, re.MULTILINE)
        if not status or status[1].lower() not in ADR_STATES:
            errors.append(f"{relative}: missing/invalid ADR status")
        elif status[1].lower() == "superseded":
            replacement = re.search(r"^superseded_by:\s*(\S+)", text, re.MULTILINE)
            if not replacement or not (file.parent / replacement[1]).is_file():
                errors.append(f"{relative}: missing/invalid superseded_by target")
    return errors


def check_ledger(file, root):
    """Every ledger row has a unique id of the file's release, a date and an implementation, and each ADR any cell cites exists."""
    errors = []
    relative = file.relative_to(root).as_posix()
    adrs = {path.name[:4] for path in (root / "docs/adr").glob("[0-9][0-9][0-9][0-9]-*.md")}
    release = LEDGER_RELEASE.match(file.stem)
    prefix = f"{release[1]}.{release[2]}-" if release else None
    header, skip, seen, rows, bad_tables = None, False, set(), 0, 0
    for number, line in enumerate(prose(file.read_text(encoding="utf-8")).splitlines(), start=1):
        if not line.lstrip().startswith("|"):
            header, skip = None, False
            continue
        if skip:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if header is None:
            header = [cell.lower() for cell in cells]
            missing = [column for column in LEDGER_COLUMNS if column not in header]
            if missing:
                errors.append(f"{relative}:{number}: a ledger table needs the columns {', '.join(LEDGER_COLUMNS)}")
                # Its rows cannot be read against columns it lacks.
                skip, bad_tables = True, bad_tables + 1
            continue
        if all(set(cell) <= set("-: ") for cell in cells):
            continue
        rows += 1
        if len(cells) != len(header):
            errors.append(f"{relative}:{number}: row has {len(cells)} cells, the header {len(header)}")
            continue
        row = dict(zip(header, cells))
        ident = row.get("id", "")
        if not LEDGER_ID.match(ident):
            errors.append(f"{relative}:{number}: ledger id {ident!r} is not <release>-<letter><number>")
        elif prefix and not ident.startswith(prefix):
            errors.append(f"{relative}:{number}: ledger id {ident} is not of this file's release {prefix[:-1]}")
        elif ident in seen:
            errors.append(f"{relative}:{number}: duplicate ledger id {ident}")
        seen.add(ident)
        if not LEDGER_DATE.match(row.get("date", "")):
            errors.append(f"{relative}:{number}: {ident} has no YYYY-MM-DD date")
        implementation = row.get("implemented by", "")
        if not implementation:
            errors.append(f"{relative}:{number}: {ident} names no implementation")
        cited = {adr for cell in cells for group in ADR_CITATION.findall(cell) for adr in re.findall(r"\d{4}", group)}
        for adr in sorted(cited - adrs):
            errors.append(f"{relative}:{number}: {ident} cites ADR {adr}, which does not exist")
    if not rows and not bad_tables:
        errors.append(f"{relative}: a decision ledger needs a table of decisions")
    return errors


def check_placement(root):
    errors = []
    docs = root / "docs"
    for path in sorted(docs.rglob("*")) if docs.is_dir() else []:
        if not path.is_file():
            continue
        parts = path.relative_to(docs).parts
        allowed = parts[0] in DOCS_DIRECTORIES if len(parts) > 1 else parts[0] in DOCS_FILES
        if not allowed:
            errors.append(f"{path.relative_to(root).as_posix()}: outside the docs layout (see docs/README.md)")
    return errors


def check(root):
    files = [root / p for p in ("AGENTS.md", "CONTEXT.md", "README.md", "desktop/web/ui-gallery/README.md", ".beads/README.md")]
    for directory in ("docs", ".interface-design"):
        files.extend((root / directory).rglob("*.md"))
    ledgers = sorted((root / "docs/decisions").glob("*.md"))
    return check_placement(root) + [
        error for file in sorted(set(files)) if file.is_file() for error in check_document(file, root)
    ] + [error for file in ledgers for error in check_ledger(file, root)]


if __name__ == "__main__":
    failures = check(ROOT)
    for failure in failures:
        print(failure, file=sys.stderr)
    print(f"Documentation checks: {len(failures)} error(s)")
    sys.exit(bool(failures))
