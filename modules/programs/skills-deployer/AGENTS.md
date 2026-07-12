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

## Local Skill Intent

These notes are maintainer-facing source intent, not distributed skill-package
content. Keep receiver-facing routing and execution contracts in each `SKILL.md`;
use this section to preserve author intent, overlap boundaries, and drift checks
when revising local skills.

### `accessibility-ux`

- Purpose: make UI accessibility and accessibility-adjacent UX shape planning, implementation, review, and behavior-preserving refactors.
- Preserve the boundary around observable UI behavior: semantics, keyboard operation, focus, forms, errors, contrast, reflow, status messages, screen-reader support, and cognitive load tied to those surfaces.
- Do not broaden it into product strategy, generic UX taste, legal compliance advice, or framework documentation.
- It may inform `refactor-maintainability` only when the refactor has UI behavior invariants.
- Drift signal: the skill starts reading like a WCAG encyclopedia, design critique rubric, or general usability manifesto instead of changing agent behavior on concrete UI tasks.

### `agent-reports`

- Purpose: standardize durable handoff report artifacts under `.agents/reports/`.
- The maintainer priority is format consistency: report type, filename, required sections, validation state, evidence, and unresolved follow-ups should be predictable across agents.
- Preserve enough handoff semantics that the format helps a later agent resume work rather than merely satisfying a template.
- Do not expand it to specs, plans, commit messages, PR comments, inline review notes, or ordinary chat status updates.
- Drift signal: report production becomes a generic Markdown-summary skill, or template mechanics crowd out evidence and unresolved-risk reporting.

### `staged-agent-workflow`

- Purpose: coordinate approval-gated spec, plan, and implementation profiles through capability-based delegation.
- Keep runtime-specific command and agent names outside the reusable skill; each consumer maps local agents to the skill's capabilities.
- Preserve `agent-reports` as the canonical owner of durable report formats and filename policy.
- Drift signal: the skill becomes tied to one command surface, duplicates specialist artifact templates, or silently substitutes missing capabilities.

### `liminal-lens`

- Purpose: adjust dialogue posture when the user's request is a compressed, not-yet-finalized thought.
- Preserve the boundary that this skill changes how uncertainty is surfaced; it does not own requirements analysis, implementation planning, or brainstorming as standalone work.
- It should keep normal task discipline intact: inspect relevant artifacts, verify claims, and then ask only bounded questions that affect the next step.
- Stop using it once the user signals convergence or asks for direct execution.
- Drift signal: the skill becomes a reason to ask generic clarification checklists, avoid implementation, or keep reopening choices after the user has decided.

### `prompt-interface-design`

- Purpose: design or review model-facing prompt surfaces by reasoning from what the receiving model or agent will actually see.
- Owns receiver-visible prompts, AGENTS.md guidance, subagent handoffs, command prompts, reusable prompt templates, instruction layering, output contracts, and prompt bloat control.
- It does not own Agent Skill package boundaries, frontmatter strategy, reference/assets/scripts placement, or skill overlap audits; those belong to `skill-architect`.
- Do not broaden it into generic prompt-engineering advice, normal user-facing answers, or domain-specific coding guidance.
- Drift signal: it starts making packaging decisions for skills, or it becomes a style guide for all technical writing rather than a prompt interface design tool.

### `parallax-reflection`

- Purpose: let the same agent reread its own produced artifact through a verification lens before finalizing.
- Preserve the self-review boundary: externalize intended behavior, trace representative flows, expose assumptions, compare against evidence, and classify concrete defects or residual risks.
- It is not a substitute for `tester`, independent third-party review, focused code review, or broad ideation.
- Use it after producing a plan, review, code, or technical artifact when self-checking can catch mismatches before delivery.
- Drift signal: it becomes a mandatory quality gate for every response, a generic checklist, or an excuse to claim independent validation.

### `refactor-maintainability`

- Purpose: support maintainability work whose central contract is preserving behavior.
- The core ownership is behavior-preserving design: identify safe cleanup boundaries, invariants, sequencing, split points, and verification expectations.
- It may classify smells and suggest implementation patterns, but those are secondary to protecting observable behavior.
- Do not use it to smuggle feature work, intentional bug fixes, rewrites, migrations, performance optimization, security-boundary changes, or formatting-only disputes into a refactor.
- Drift signal: the skill normalizes broad rewrites, accepts behavior changes without an explicit separate task, or treats code-smell labels as sufficient justification for changes.

### `skill-architect`

- Purpose: design, review, revise, split, merge, or package reusable Agent Skill artifacts.
- Owns skill routing boundaries, `SKILL.md` execution contracts, frontmatter descriptions, reference/assets/scripts placement, granularity, overlap audits, and packaging decisions.
- It should convert domain guidance into skill-shaped behavior only when a reusable opt-in skill boundary exists.
- Leave receiver-visible prompt surfaces outside the skill package problem to `prompt-interface-design` unless the artifact being designed is itself a skill.
- Drift signal: it becomes a general prompt-design or domain-execution skill, or it encourages dumping domain essays into `SKILL.md` instead of shaping concise agent behavior.

## Deployment Registry Discipline

- When adding or removing a local skill, update `programs.skills-deployer.skills` in `default.nix` unless the task is explicitly source-only.
- Treat `targetDirs` as an intentional runtime matrix, not a default to copy blindly. Preserve existing target choices unless the task decides which runtimes should receive the skill.
- For external skill sources, keep `source` and `subdir` wiring explicit enough that future agents can identify the packaged skill root.
- Do not add manual imports between Denix modules; files under `modules/` are auto-discovered by the repository architecture.

## Validation Guidance

- For registry changes, parse `modules/programs/skills-deployer/default.nix` and check that new files are git-tracked before any flake build that must see them.
- For skill package changes, verify the skill frontmatter, directory name, deployment entry, and target directories agree.
- For prompt- or skill-interface changes, prefer a focused read of the future receiver-visible `SKILL.md` plus any referenced files over broad repository scans.
