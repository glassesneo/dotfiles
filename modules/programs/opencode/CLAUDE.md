# modules/programs/opencode/

## Agent Source of Truth

- `prompts/*.md` contains the canonical full prompt content for OpenCode agents in this module.
- `prompts/shared/*.md` contains canonical shared prompt fragments, contracts, policies, and context snippets.
- `default.nix` owns agent metadata, permissions, shared fragment loading, and placeholder rendering/wiring.

## Local Agents

- `sensei` is a primary explanation agent for teaching reports and git revisions/ranges to project outsiders. Its prompt lives in `prompts/sensei.md`; metadata and permissions live in `default.nix`.

## SketchyBar Integration

This module does not deploy a SketchyBar plugin.
