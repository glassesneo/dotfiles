#!/usr/bin/env python3
"""Check local documentation links and explicit repository-owned source paths."""

from __future__ import annotations

import argparse
import re
import tempfile
from pathlib import Path

MARKDOWN_LINK = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
ORG_FILE_LINK = re.compile(r"\[\[file:([^\]]+?)(?:\]\[[^\]]*\])?\]\]")
NIX_PATH = re.compile(
    r"(?:\bsource\s*=\s*|\b(?:builtins|lib)\.readFile\s+|\bpkgs\.replaceVars\s+)"
    r"((?:\.\.?/)[A-Za-z0-9_+./-]+)"
)
NIX_INTERPOLATED_PATH = re.compile(r"\$\{((?:\.\.?/)[^}\s]+)\}([A-Za-z0-9_+./-]*)")
SKILL_SOURCE = re.compile(r"\bsource\s*=\s*(\.\.?/skills/[A-Za-z0-9_+./-]+)")
PROMPT_CALL = re.compile(r'\b(readAgentPrompt|renderAgentPrompt|readCommandPrompt|readSharedPrompt)\s+"([^"]+)"')
EXCLUDED_PARTS = {".agents", ".direnv", ".git", "node_modules"}


def repository_files(root: Path, suffix: str) -> list[Path]:
    return sorted(path for path in root.rglob(f"*{suffix}") if EXCLUDED_PARTS.isdisjoint(path.relative_to(root).parts))


def local_target(document: Path, raw_target: str) -> Path | None:
    target = raw_target.strip().split(maxsplit=1)[0].strip("<>")
    target = target.split("#", 1)[0]
    if not target or "://" in target or target.startswith(("mailto:", "#", "/")):
        return None
    return (document.parent / target).resolve()


def check_document_links(root: Path) -> list[str]:
    errors: list[str] = []
    for document in repository_files(root, ".md") + repository_files(root, ".org"):
        text = document.read_text(encoding="utf-8")
        pattern = ORG_FILE_LINK if document.suffix == ".org" else MARKDOWN_LINK
        for match in pattern.finditer(text):
            target = local_target(document, match.group(1))
            if target is not None and not target.exists():
                errors.append(f"{document.relative_to(root)}: missing local link {match.group(1)!r}")
    return errors


def active_nix_lines(path: Path) -> str:
    return "\n".join(line for line in path.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))


def check_nix_sources(root: Path) -> list[str]:
    errors: list[str] = []
    for nix_file in repository_files(root, ".nix"):
        text = active_nix_lines(nix_file)
        references = [(match.group(1), "") for match in NIX_PATH.finditer(text)]
        references += [(match.group(1), match.group(2)) for match in NIX_INTERPOLATED_PATH.finditer(text)]
        for base, suffix in references:
            target = (nix_file.parent / base).resolve()
            if suffix:
                target /= suffix.lstrip("/")
            if not target.exists():
                errors.append(f"{nix_file.relative_to(root)}: missing Nix source {base}{suffix}")

        if nix_file == root / "modules/programs/skills-deployer/default.nix":
            for match in SKILL_SOURCE.finditer(text):
                skill_dir = (nix_file.parent / match.group(1)).resolve()
                if not (skill_dir / "SKILL.md").is_file():
                    errors.append(f"{nix_file.relative_to(root)}: skill source lacks SKILL.md: {match.group(1)}")
    return errors


def check_prompt_registries(root: Path) -> list[str]:
    errors: list[str] = []
    opencode = root / "modules/programs/opencode"
    readers = {
        "readAgentPrompt": opencode / "prompts",
        "renderAgentPrompt": opencode / "prompts",
        "readCommandPrompt": opencode / "prompts/commands",
        "readSharedPrompt": opencode / "prompts/shared",
    }
    for nix_file in sorted(opencode.glob("*.nix")):
        text = active_nix_lines(nix_file)
        for reader, name in PROMPT_CALL.findall(text):
            target = readers[reader] / f"{name}.md"
            if not target.is_file():
                errors.append(f"{nix_file.relative_to(root)}: {reader} references missing prompt {name!r}")
    return errors


def check_repository(root: Path) -> list[str]:
    root = root.resolve()
    return sorted(check_document_links(root) + check_nix_sources(root) + check_prompt_registries(root))


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="repository-consistency-") as value:
        root = Path(value)
        (root / "docs").mkdir()
        (root / "docs/guide.md").write_text("[missing](missing.md)\n", encoding="utf-8")
        skills = root / "modules/programs/skills-deployer"
        skills.mkdir(parents=True)
        (skills / "default.nix").write_text("{ source = ./skills/missing; }\n", encoding="utf-8")
        errors = check_repository(root)
        assert any("missing local link" in error for error in errors), errors
        assert any("missing Nix source" in error for error in errors), errors
        assert any("skill source lacks SKILL.md" in error for error in errors), errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    if args.root is None:
        return 0
    errors = check_repository(args.root)
    if errors:
        for error in errors:
            print(error)
        return 1
    print("repository consistency checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
