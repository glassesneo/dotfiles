# modules/programs/skills-deployer/

## Ownership

- This subtree owns the canonical source packages for reusable agent skills that are deployed into user-facing runtime directories.
- `default.nix` owns the deployment registry: skill names, source paths, optional source subdirectories, and target runtime directories.
- `skills/<name>/` owns each local skill package. `skills/<name>/SKILL.md` is the primary model-facing entrypoint; references, assets, and scripts belong inside the same package when needed.

## Source-of-Truth Rules

- Edit local skill source packages here rather than deployed copies under `~/.agents/skills`, `~/.claude/skills`, or `~/.cursor/skills`.
- Preserve the standard skill layout: directory name matches frontmatter `name`, and the entry file is named exactly `SKILL.md`.
- Keep frontmatter descriptions concise and routing-oriented: include what the skill does, when to use it, and important non-use boundaries only when they prevent likely misrouting.
- Keep `SKILL.md` focused on reusable behavior for future agents. Put optional long examples, templates, and checklists in `references/` instead of bloating the entrypoint.

## Deployment Registry Discipline

- When adding or removing a local skill, update `programs.skills-deployer.skills` in `default.nix` unless the task is explicitly source-only.
- Treat `targetDirs` as an intentional runtime matrix, not a default to copy blindly. Preserve existing target choices unless the task decides which runtimes should receive the skill.
- For external skill sources, keep `source` and `subdir` wiring explicit enough that future agents can identify the packaged skill root.
- Do not add manual imports between Denix modules; files under `modules/` are auto-discovered by the repository architecture.

## Validation Guidance

- For registry changes, parse `modules/programs/skills-deployer/default.nix` and check that new files are git-tracked before any flake build that must see them.
- For skill package changes, verify the skill frontmatter, directory name, deployment entry, and target directories agree.
- For prompt- or skill-interface changes, prefer a focused read of the future receiver-visible `SKILL.md` plus any referenced files over broad repository scans.
