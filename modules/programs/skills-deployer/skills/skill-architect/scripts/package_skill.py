#!/usr/bin/env python3
"""package_skill.py - package a skill directory as a zip archive.

Dependencies: Python standard library only. No extra installation is required.
Usage: python3 package_skill.py <skill-dir> [--out <output-dir>]
Failure condition: exit with an error if SKILL.md does not exist directly under skill-dir.
Output: <skill-dir-name>.zip

Hidden files, hidden directories, **pycache**, and .git are excluded.
"""

import argparse
import sys
import zipfile
from pathlib import Path

EXCLUDE_NAMES = {".DS_Store", "**pycache**", ".git"}

def should_exclude(path: Path) -> bool:
for part in path.parts:
if part in EXCLUDE_NAMES:
return True
if part.startswith("."):
return True
return False

def main():
parser = argparse.ArgumentParser(description="Package a skill directory as a zip archive")
parser.add_argument("skill_dir", help="Path to a skill directory containing SKILL.md")
parser.add_argument("--out", default=None, help="Output directory. Defaults to the parent of skill_dir.")
args = parser.parse_args()

```
skill_dir = Path(args.skill_dir).resolve()
skill_md = skill_dir / "SKILL.md"

# Pre-check: verify that the target is a valid skill directory.
if not skill_dir.is_dir():
    print(f"[FAIL] Directory does not exist: {skill_dir}")
    sys.exit(1)
if not skill_md.exists():
    print(f"[FAIL] SKILL.md was not found. This may not be a skill directory: {skill_dir}")
    sys.exit(1)

out_dir = Path(args.out).resolve() if args.out else skill_dir.parent
out_dir.mkdir(parents=True, exist_ok=True)
zip_path = out_dir / f"{skill_dir.name}.zip"

files_written = 0
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for path in sorted(skill_dir.rglob("*")):
        if path.is_dir():
            continue
        if should_exclude(path.relative_to(skill_dir)):
            continue

        arcname = Path(skill_dir.name) / path.relative_to(skill_dir)
        zf.write(path, arcname)
        files_written += 1

# Post-check: verify that the zip is not empty.
if files_written == 0:
    print(
        f"[FAIL] No files were written. "
        f"Check whether the exclusion rules are too broad: {skill_dir}"
    )
    sys.exit(1)

print(f"[OK] Packaged {files_written} file(s) into {zip_path}")
```

if **name** == "**main**":
main()
