# modules/config/agent-skills/

## Overview

Declarative AI agent skill management and deployment system. Skills are SKILL.md files containing instructions/prompts deployed to agent-specific directories.

## Skill Format

Each skill is a directory containing a `SKILL.md` with YAML frontmatter:
```yaml
---
name: <skill-name>
description: <brief description for agent discovery>
allowed-tools: [optional tool restrictions]
---
# Content (markdown instructions)
```

## Adding a New Skill

1. Create `modules/config/agent-skills/<name>/SKILL.md`
2. Register in `default.nix` under `myconfig.always.agentSkills.skills`:
   ```nix
   <name> = { path = ./<name>; subdir = "."; discoverable = false; explicitPath = "."; };
   ```
3. Assign to agents in rice/host config under `myconfig.agentSkills.agents.<agent>.skills`
4. Build with `nh home switch`

## Deployment Strategies

- **symlink-tree** (default): Recursive symlinks in `home.file`. Used by Claude Code (`.claude/skills/`).
- **copy**: Copies files via activation script. Required for Codex (doesn't follow symlinks).

## Skill Sources

- **Local**: `./skill-name` directories in this module
- **External flake inputs**: `inputs.anthropic-skills`, `inputs.ui-ux-pro-max`, `inputs.sparze`
- **Derivations**: `llm-agents.agent-browser`

## Current Skills

| Skill | Purpose |
|-------|---------|
| ai-first-doccomments | AI-optimized documentation comments |
| codex-exec | One-shot Codex queries |
| codex-subagent | Interactive Codex sessions in tmux |
| hierarchical-claude-md | CLAUDE.md file organization strategy |
| tmux-runner | Run commands in tmux panes |

## Key Detail

Agent-to-skill mappings are **not** defined here. They live in agent modules (e.g., `modules/programs/claude-code/`, `modules/programs/opencode/`).
