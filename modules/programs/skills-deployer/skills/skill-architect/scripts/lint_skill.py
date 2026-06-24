#!/usr/bin/env python3
"""lint_skill.py - deterministic self-audit script for skill-architect

Dependencies: Python standard library only. No extra installation is required.
Usage: python3 lint_skill.py <skill-dir>
Exit code: 0 = no FAIL items / 1 = one or more FAIL items. WARN-only results exit with 0.

This script checks only items that can be judged structurally and mechanically.
Human judgment, such as responsibility width and prose quality, must be handled with
references/bad-practice-checklist.md.
"""

import argparse
import re
import sys
from pathlib import Path

DEFAULT_VAGUE_WORDS = [
"appropriately",
"make it good",
"well",
"cleanly",
"properly",
"thoroughly",
"as needed",
"depending on the situation",
"where appropriate",
"flexibly",
"safely",
"conservatively",
"carefully",
"review",
"research",
"investigate",
"improve",
"organize",
"optimize",
"latest information",
"up-to-date information",
"current information",
]
HYPE_WORDS = ["best", "ultimate", "perfect", "powerful", "comprehensive"]
NEGATIVE_TRIGGER_MARKERS = [
"do not use",
"don't use",
"out of scope",
"not for",
"does not handle",
"must not",
"instead use",
"neighboring skill",
]

class Report:
"""Print PASS/WARN/FAIL immediately while counting each result."""

```
def __init__(self):
    self.n_pass = 0
    self.n_warn = 0
    self.n_fail = 0

def ok(self, msg):
    self.n_pass += 1
    print(f"[PASS] {msg}")

def warn(self, msg):
    self.n_warn += 1
    print(f"[WARN] {msg}")

def fail(self, msg):
    self.n_fail += 1
    print(f"[FAIL] {msg}")

def has_fail(self):
    return self.n_fail > 0

def summary(self):
    print(f"\nTotal: PASS={self.n_pass} WARN={self.n_warn} FAIL={self.n_fail}")
```

def parse_frontmatter(lines):
"""Extract the leading --- ... --- block.

```
Complex YAML such as nested objects and lists is not supported.

Returns:
    (frontmatter_lines, body_start_index), or (None, 0) if no frontmatter is found.
"""
if not lines or lines[0].strip() != "---":
    return None, 0
for i in range(1, len(lines)):
    if lines[i].strip() == "---":
        return lines[1:i], i + 1
return None, 0
```

def extract_kv(frontmatter_lines, key):
"""Extract `key: value`.

```
This includes simple support for double-quoted multi-line values.
"""
pattern = re.compile(rf"^{key}:\s*(.*)$")
for idx, line in enumerate(frontmatter_lines):
    m = pattern.match(line)
    if not m:
        continue
    value = m.group(1).strip()
    if value.startswith('"') and not value.endswith('"'):
        collected = [value[1:]]
        for cont in frontmatter_lines[idx + 1:]:
            if cont.rstrip().endswith('"'):
                collected.append(cont.rstrip()[:-1])
                break
            collected.append(cont)
        return " ".join(collected).strip()
    return value.strip('"')
return None
```

def load_vague_words(skill_dir):
ref = skill_dir / "references" / "vague-words.md"
if not ref.exists():
return DEFAULT_VAGUE_WORDS

````
words = []
for line in ref.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if (
        not line
        or line.startswith("#")
        or line.startswith("|")
        or line.startswith("-")
        or line.startswith("```")
    ):
        continue

    # Treat short standalone lines as terms. This avoids scanning prose,
    # while still allowing multi-word English phrases.
    if len(line) <= 80 and not line.endswith("."):
        words.append(line)

return words or DEFAULT_VAGUE_WORDS
````

def check_frontmatter(skill_md_path, report):
text = skill_md_path.read_text(encoding="utf-8")
lines = text.splitlines()
fm_lines, body_start = parse_frontmatter(lines)
if fm_lines is None:
report.fail("frontmatter block was not found at the beginning of SKILL.md")
return lines, 0

```
name = extract_kv(fm_lines, "name")
description = extract_kv(fm_lines, "description")

if not name:
    report.fail("frontmatter does not contain `name`")
else:
    if re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name):
        report.ok(f"`name` is valid kebab-case: {name}")
    else:
        report.fail(f"`name` is not kebab-case with lowercase letters, numbers, and hyphens only: {name}")

    dir_name = skill_md_path.parent.name
    if name != dir_name:
        report.warn(f"`name` '{name}' does not match directory name '{dir_name}'")

if not description:
    report.fail("frontmatter does not contain `description`")
else:
    length = len(description)
    if length < 60:
        report.warn(f"`description` is short ({length} characters). Verify that trigger conditions are complete.")
    elif length > 600:
        report.warn(f"`description` is long ({length} characters). It is always loaded into context; consider shortening it.")
    else:
        report.ok(f"`description` length is within the expected range ({length} characters)")

    lowered_description = description.lower()

    if any(m in lowered_description for m in NEGATIVE_TRIGGER_MARKERS):
        report.ok("`description` contains wording equivalent to when-not-to-use")
    else:
        report.warn("No when-not-to-use marker was found in `description`. This may be a false positive; inspect manually.")

    found_hype = [w for w in HYPE_WORDS if w in lowered_description]
    if found_hype:
        report.warn(f"`description` contains hype words: {', '.join(found_hype)}")
    else:
        report.ok("No hype words were found in `description`")

return lines, body_start
```

def check_body(skill_dir, lines, body_start, report):
body_lines = lines[body_start:]
n_lines = len(body_lines)
if n_lines > 500:
report.warn(f"`SKILL.md` body has {n_lines} lines. If it exceeds 500 lines, consider moving material into `references/`.")
else:
report.ok(f"`SKILL.md` body has {n_lines} lines, within the 500-line guideline")

```
body_text = "\n".join(body_lines)
lowered_body_text = body_text.lower()

vague_words = load_vague_words(skill_dir)
hits = []
for i, line in enumerate(body_lines, start=body_start + 1):
    lowered_line = line.lower()
    for w in vague_words:
        if w.lower() in lowered_line:
            hits.append((i, w, line.strip()))

if hits:
    report.warn(
        f"Found {len(hits)} vague-term occurrence(s). "
        "Occurrences quoted as examples of bad wording may be false positives; inspect manually."
    )
    for i, w, line in hits[:15]:
        print(f"    L{i}: \"{w}\" -> {line}")
    if len(hits) > 15:
        print(f"    ...and {len(hits) - 15} more")
else:
    report.ok("No vague terms were detected")

if re.search(r"safety boundaries|destructive operations|state-changing", lowered_body_text):
    report.ok("Safety boundary wording was found")
else:
    report.warn(
        "No safety boundary or destructive-operation wording was found. "
        "If not applicable, state that explicitly."
    )

if re.search(r"evaluation tasks|positive trigger test|negative trigger test|execution test|eval", lowered_body_text):
    report.ok("Evaluation task wording was found")
else:
    report.warn("No mention of evaluation tasks was found")

referenced = set(re.findall(r"\b(references/[\w\-./]+|scripts/[\w\-./]+|assets/[\w\-./]+)", body_text))
for rel in sorted(referenced):
    target = skill_dir / rel
    if target.exists():
        report.ok(f"Referenced file exists: {rel}")
    else:
        report.fail(f"`SKILL.md` references a missing file: {rel}")
```

def check_eval_file(skill_dir, report):
ref_dir = skill_dir / "references"
if not ref_dir.exists():
report.warn("No `references/` directory was found. Verify where evaluation tasks are written.")
return

```
eval_files = [p for p in ref_dir.glob("*eval*") if p.is_file()]
if not eval_files:
    report.warn("No file whose name contains `eval` was found under `references/`. Verify where evaluation tasks are written.")
    return

total_items = 0
for f in eval_files:
    total_items += len(re.findall(r"^##\s", f.read_text(encoding="utf-8"), re.MULTILINE))

if total_items >= 3:
    report.ok(f"Found {total_items} evaluation-like heading(s), which meets the minimum of 3")
else:
    report.warn(f"Found only {total_items} evaluation-like heading(s). At least 3 are recommended.")
```

def main():
parser = argparse.ArgumentParser(description="self-audit lint for skill-architect")
parser.add_argument("skill_dir", help="Path to a skill directory containing SKILL.md")
args = parser.parse_args()

```
skill_dir = Path(args.skill_dir).resolve()
skill_md_path = skill_dir / "SKILL.md"

if not skill_dir.is_dir():
    print(f"[FAIL] Directory does not exist: {skill_dir}")
    sys.exit(1)
if not skill_md_path.exists():
    print(f"[FAIL] SKILL.md was not found: {skill_md_path}")
    sys.exit(1)

print(f"--- skill-architect lint report: {skill_dir.name} ---\n")

report = Report()
lines, body_start = check_frontmatter(skill_md_path, report)
check_body(skill_dir, lines, body_start, report)
check_eval_file(skill_dir, report)
report.summary()

sys.exit(1 if report.has_fail() else 0)
```

if **name** == "**main**":
main()
