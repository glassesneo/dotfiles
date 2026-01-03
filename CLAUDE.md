# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview
Denix-based Nix dotfiles for macOS + Home Manager, declarative and modular.
Host: `kurogane` (desktop), user: `neo`.
Key paths: `hosts/` and `modules/` drive configuration discovery.

## Build and Deployment Commands
This repository uses `nh` (nix helper) for streamlined configuration management.

### Applying Configurations

**nix-darwin (macOS system + Home Manager)**:
```bash
# Standard build and activation (applies both darwin and home-manager configs)
# -L: Print build logs, -t: Show trace on errors
nh darwin switch . --hostname kurogane -Lt

# Shorter form when in dotfiles directory
nh darwin switch . -H kurogane -Lt

# Dry run (preview changes without applying)
nh darwin switch . -H kurogane -Lt --dry

# Ask for confirmation before applying
nh darwin switch . -H kurogane -Lt --ask

# Update all flake inputs before building
nh darwin switch . -H kurogane -Lt --update

# Update specific flake input(s)
nh darwin switch . -H kurogane -Lt --update-input nixpkgs
```

**Home Manager only** (user environment only):
```bash
# Build and activate home-manager configuration
nh home switch

# With specific configuration (when NH_FLAKE is not set)
nh home switch .#neo

# Dry run
nh home switch --dry
```

**Build without activation**:
```bash
# Build darwin configuration
nh darwin build

# Build home-manager configuration
nh home build
```

### Development and Testing
```bash
# Enter development shell (provides deno, emmylua-ls, stylua)
nix develop

# Validate flake structure
nix flake check

# Show available outputs
nix flake show

# Update all flake inputs to latest versions
nix flake update

# Update specific input
nix flake lock --update-input nixpkgs

# Launch REPL with darwin configuration loaded
nh darwin repl

# Launch REPL with home-manager configuration loaded
nh home repl
```

### Cleanup
```bash
# Clean all old generations and garbage collect
nh clean all --keep 5  # Keep last 5 generations

# Clean current user's profiles only
nh clean user --keep 3

# Clean specific profile
nh clean profile <profile-path> --keep 5
```

### Node Package Management
When modifying `node2nix/node-packages.json`:
```bash
# Regenerate nix expressions from node-packages.json
cd node2nix
nix-shell -p node2nix --run "node2nix --input node-packages.json --output node-packages.nix --composition default.nix"
```

## Denix Architecture (Non-Obvious Patterns Only)
- Module discovery: `paths = [./hosts ./modules]` auto-imports everything.
- Extension system: `extensions = [args base.withConfig]` wires shared args + base config.
- Platform blocks: `home.ifEnabled` targets `config` for `moduleSystem = "home"` and `config.home-manager.users.neo` for `"darwin"` when HM is enabled.
- Shared arguments: `myconfig.always.args.shared.<key>` pattern for global args.
- Host routing: `delib.host` + conditional config when `config.${myconfigName}.host` matches.

## Module Examples (References Only)
- Minimal: @modules/programs/fd.nix
- With options: @modules/programs/git.nix
- Service: @modules/services/aerospace.nix
- Nixvim: @modules/programs/nixvim/

## Codebase Organization (Just Paths)
- Programs: @modules/programs/
- Services: @modules/services/
- System: @modules/toplevel/
- Hosts: @hosts/
- Config core: @modules/config/
- Node2nix: @node2nix/
- Secrets: @secrets/
- Var artifacts: @var/

## Critical Implementation Notes

### Kiri Wrapper
Kiri MCP uses a wrapper to avoid tree-sitter download issues, implemented in:
- @modules/config/node2nix.nix

Key behavior:
- Wrapper runs `kiri-mcp-server` via `npx` with explicit `PATH`.
- Kiri writes its index to `.kiri/index.duckdb` at repo root.
- Watch mode uses `--watch` and keeps the DuckDB index in `.kiri/`.

### MCP Architecture
Centralized MCP server definitions live in:
- @modules/programs/mcp-servers/default.nix

Each AI tool uses a separate memory file to prevent conflicts:
- `claudecode_memory.json`, `opencode_memory.json`, `crush_memory.json` under `$XDG_DATA_HOME`.

### Secrets
- All secrets are encrypted via agenix and referenced as `config.age.secrets.<key>.path`.
- Do not hardcode secrets anywhere; use `modules/toplevel/secrets.nix` to wire env vars.
- Encrypted blobs live in: @secrets/

### Constants
User metadata is centralized in:
- @modules/config/constants.nix

Use `constants.username`, `constants.userfullname`, `constants.useremail` instead of literals.

### Claude Code SketchyBar Integration
Claude Code integrates with SketchyBar to show real-time status in the menu bar:
- @modules/programs/claude-code/default.nix (hooks defined in settings.hooks)
- @modules/services/sketchybar/rc/plugins/ai.nu

Key behavior:
- Hooks trigger on UserPromptSubmit (active) and Stop (inactive) events.
- Hooks are configured in `settings.hooks` which embeds them in `~/.claude/settings.json`.
- Handler scripts (Nix writeShellScript) send events to SketchyBar with status and project directory.
- SketchyBar plugin displays a robot icon that changes color:
  - Green when Claude is actively processing a prompt
  - Gray when idle/stopped
- Popup shows current project directory when hovering over the icon.

### OpenCode SketchyBar Integration
OpenCode integrates with SketchyBar using the plugin system:
- @modules/programs/opencode/plugins/sketchybar.js
- @modules/services/sketchybar/rc/plugins/ai.nu (shared with Claude Code)

Key behavior:
- Plugin subscribes to session.status, session.idle, session.deleted, and session.error events.
- Sends `opencode_status` events to SketchyBar with status, agent name, and project directory.
- SketchyBar shows "OpenCode [agent_name]: project" when active.
- Plugin is deployed to `~/.config/opencode/plugin/` and loaded automatically.

## Essential Commands
```bash
nh darwin switch . -H kurogane -Lt --update
nh darwin switch . -H kurogane -Lt --update-input nixpkgs
nix flake check
nix flake update
nh clean all --keep 5
```
