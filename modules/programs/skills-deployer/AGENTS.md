# modules/programs/skills-deployer/

## Source and Deployment Ownership

- This subtree is the canonical source for reusable skill packages. Edit it rather than deployed copies under user runtime directories.
- `default.nix` owns the deployment registry and intentional target-runtime matrix.
- Each `skills/<name>/` package owns its `SKILL.md` entrypoint and any local references, assets, or scripts.

## Package Contract

- Keep the directory name, frontmatter `name`, and exact `SKILL.md` entry filename aligned.
- Keep frontmatter descriptions concise and routing-oriented. Keep `SKILL.md` focused on reusable receiver behavior; move optional long examples, templates, and checklists to package references.
- Preserve ownership boundaries between skills rather than copying one skill's workflow or artifact schema into another. In particular, `agent-reports` owns durable report formats and `staged-agent-workflow` owns reusable approval-gated stage behavior.
- When adding or removing a local skill, update the registry unless the task is explicitly source-only. Do not copy existing `targetDirs` blindly; deployment membership is an explicit decision.
