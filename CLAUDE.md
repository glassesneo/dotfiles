# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Nix-based modular dotfiles repository using **Denix** to manage both Home Manager (user environment) and nix-darwin (macOS system) configurations. The architecture enables declarative, reproducible system configuration with clear separation between personal settings, program configurations, and system-level settings.

**Host**: `kurogane` (desktop machine)
**User**: `neo`

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

**Current node packages** (defined in `node2nix/node-packages.json`):
- AI Tools: `@anthropic-ai/claude-code`, `@zed-industries/claude-code-acp` (OpenCode), `@google/jules`, `@google/gemini-cli`
- MCP Servers: `@brave/brave-search-mcp-server`, `@mizchi/readability`, `tavily-mcp`, `chrome-devtools-mcp`

## Architecture

### Denix Module System

Denix is a modular configuration framework that uses the `delib.module` function to define reusable configuration modules. Each module wraps NixOS, Home Manager, or nix-darwin configurations with conditional logic and standardized option handling.

**Module Structure**:
```nix
delib.module {
  name = "category.programname";  # Module identifier, matches option path

  options.category.programname = with delib; {
    enable = boolOption true;  # or false for opt-in
    # ... other options
  };

  # Conditional blocks (applied when cfg.enable = true)
  home.ifEnabled = {cfg, ...}: {
    # Home Manager configuration
  };

  darwin.ifEnabled = {cfg, ...}: {
    # nix-darwin configuration
  };

  nixos.ifEnabled = {cfg, ...}: {
    # NixOS configuration (supported but not used in this repo)
  };

  # Unconditional blocks (always applied)
  home.always = {...}: {
    # Always applied Home Manager config
  };
}
```

**Conditional Execution**:
- `ifEnabled`: Applied only when `cfg.enable` exists and is `true`
- `ifDisabled`: Applied only when `cfg.enable` exists and is `false`
- `always`: Always executed regardless of `cfg.enable`

**Module Arguments**:
When configuration blocks are defined as functions, they receive:
- `name`: The module's name
- `cfg`: The module's config values (`config.${myconfigName}.${name}`)
- `parent`: Parent attribute set of `cfg`
- Standard nixpkgs arguments (`pkgs`, `lib`, `config`, etc.)

### Directory Structure

```
.
├── flake.nix              # Entry point: defines inputs, outputs, devShell
├── flake.lock             # Locked dependency versions
├── hosts/                 # Machine-specific definitions
│   └── kurogane/          # Current host (type: desktop)
├── modules/
│   ├── config/            # Core configuration (constants, user, home, node2nix)
│   ├── programs/          # Program-specific modules (nixvim, zsh, git, etc.)
│   ├── services/          # System services (aerospace, jankyborders, sketchybar)
│   └── toplevel/          # System-level settings (nix-darwin, nixpkgs, xdg, fonts)
├── node2nix/              # Node.js package management
└── secrets/               # Encrypted secrets (agenix)
```

### Core Modules

**config/** - Foundational configuration modules:
- `constants.nix`: User information constants (username, email, full name)
- `user.nix`: User account configuration
- `home.nix`: Home directory setup
- `node2nix.nix`: Node.js package integration (exposes `nodePkgs` to all modules)

**toplevel/** - System-wide settings:
- `nix.nix`: Nix daemon configuration, experimental features, trusted users
- `nixpkgs.nix`: Nixpkgs configuration, allowed unfree packages, system architecture
- `xdg.nix`: XDG base directory specification
- `fonts.nix`: System fonts configuration
- `shell.nix`: Default shell settings
- `brew-nix.nix`: Homebrew integration setup
- `nix-darwin/`: macOS-specific system configurations
  - `default.nix`: nix-darwin base configuration
  - `system.nix`: macOS system preferences
  - `apps.nix`: Application settings
  - `homebrew.nix`: Homebrew packages and casks

### Configuration Resolution

The `denix.lib.configurations` function orchestrates the entire configuration generation process:

```nix
mkConfigurations = moduleSystem:
  denix.lib.configurations {
    moduleSystem;           # "home" or "darwin"
    homeManagerUser = "neo";
    paths = [./hosts, ./modules];  # Module discovery paths
    extensions = [args, base.withConfig];
  };

homeConfigurations = mkConfigurations "home";     # Uses home-manager.lib.homeManagerConfiguration
darwinConfigurations = mkConfigurations "darwin"; # Uses nix-darwin.lib.darwinSystem
```

**How it works**:
1. **Module Discovery**: `denix.lib.configurations` imports all files from `paths` (hosts/ and modules/)
2. **Module System Selection**: The `moduleSystem` parameter determines which system builder to use:
   - `"home"` → `home-manager.lib.homeManagerConfiguration`
   - `"darwin"` → `nix-darwin.lib.darwinSystem`
   - `"nixos"` → `nixpkgs.lib.nixosSystem` (not used here)
3. **Extension Application**: Extensions modify how modules are processed:
   - `args`: Enables argument passing between modules
   - `base.withConfig`: Applies base configuration (`args.enable = true`, `rices.enable = false`)
4. **Conditional Application**: Based on `moduleSystem`, only relevant platform blocks are applied:
   - `home.ifEnabled` → Applied to `config` when `moduleSystem = "home"`
   - `darwin.ifEnabled` → Applied to `config` when `moduleSystem = "darwin"`
   - When `moduleSystem = "darwin"` and Home Manager module is enabled, `home.*` blocks apply to `config.home-manager.users.neo`

**Configuration Naming**:
- Base: `{hostName}` (e.g., `kurogane`)
- Home Manager: `{homeManagerUser}@{hostName}` (e.g., `neo@kurogane`)
- With rice: `{hostName}-{riceName}` (not used in this repo)

### Key Inputs

- **denix**: Module system framework (github:yunfachi/denix)
- **nixpkgs**: nixpkgs-unstable channel
- **home-manager**: User environment manager
- **nix-darwin**: macOS system configuration
- **nixvim**: Neovim configuration framework
- **agenix**: Secrets encryption
- **brew-nix**: Homebrew/Nix integration for macOS apps
- **dpp-vim** + extensions: Denops-based plugin manager for Neovim
- **mcp-hub**, **mcp-servers-nix**, **mcphub-nvim**: Model Context Protocol integrations
- **charmbracelet**: Charm community NUR (for Crush AI tool)

## Configured Programs and Services

### AI Coding Tools

This configuration includes a comprehensive AI coding toolkit with MCP server integration:

**Claude Code** (`modules/programs/claude-code.nix`):
- Anthropic's official CLI tool for Claude
- Configured with auto-update disabled
- Includes persistent memory configuration
- MCP servers: Brave Search, DeepWiki, Readability, Tavily, Chrome DevTools, Git, Time, Memory

**OpenCode** (`modules/programs/opencode/default.nix`):
- Zed-based AI coding assistant
- Custom transparent Catppuccin theme (`themes/transparent-catppuccin.json`)
- Configured with `autoshare=false` and `autoupdate=false`
- Full MCP server integration matching Claude Code setup

**Crush** (`modules/programs/crush.nix`):
- Charmbracelet's AI coding tool
- Extensive LSP configuration for: Biome, Deno, Lua (emmylua_ls), Nix (nixd), Python (basedpyright), TypeScript, Zig (zls)
- Context paths configured to read from `~/.claude/CLAUDE.md`
- MCP servers configured for enhanced capabilities

**Jules** (`modules/programs/jules.nix`):
- Google's AI coding assistant
- Installed as home package from node2nix

**Gemini CLI** (`modules/programs/gemini-cli.nix`):
- Google's Gemini command-line interface
- Managed through node2nix packages

### MCP Server Configuration

The `modules/programs/mcp-servers/default.nix` module provides centralized MCP server configuration for all AI tools. It defines four separate server configurations:

**mcphub-servers** (for Neovim's mcphub.nvim):
- Programs: filesystem, git, github (with gh token auth), memory, sequential-thinking, time
- Custom servers: brave-search, deepwiki, notion, readability, relative-filesystem, tavily, chrome-devtools

**claude-code-servers**:
- Programs: git, time, memory (separate memory file: `claudecode_memory.json`)
- Servers: brave-search, deepwiki, readability, tavily, chrome-devtools

**crush-servers**:
- Programs: git, time, memory (separate memory file: `crush_memory.json`)
- Servers: brave-search, deepwiki, readability, tavily, chrome-devtools

**opencode-servers**:
- Programs: git, time, memory (separate memory file: `opencode_memory.json`)
- Servers: brave-search, deepwiki, readability, tavily, chrome-devtools

Each AI tool maintains its own memory file to prevent conflicts, stored in `$XDG_DATA_HOME`.

### Shell and Terminal

**zsh** (`modules/programs/zsh/`):
- Default shell with extensive configuration
- Integrations: Zellij, direnv, various CLI tools
- Pure prompt configured separately

**nushell** (`modules/programs/nushell/`):
- Alternative shell configuration

**Ghostty** (`modules/programs/ghostty/`):
- Terminal emulator
- Custom cursor trail shader (`cursor_trail.glsl`)

**Zellij** (`modules/programs/zellij.nix`):
- Terminal multiplexer

**pure-prompt** (`modules/programs/pure-prompt.nix`):
- Minimal zsh prompt

### Development Tools

**Neovim/Nixvim** (`modules/programs/nixvim/`):
- Comprehensive Neovim configuration using nixvim framework
- LSP support in `lsp/` directory
- Plugins organized by category:
  - **AI**: CodeCompanion and related AI integrations (`plugins/ai/`)
  - **Completion**: blink-cmp (`plugins/blink-cmp.nix`)
  - **Editing**: Auto-pairs, comments, surround, etc. (`plugins/editing.nix`)
  - **File navigation**: oil.nvim, fzf-lua (`plugins/oil.nix`, `plugins/fzf-lua.nix`)
  - **Git**: Gitsigns, etc. (`plugins/git.nix`)
  - **Motion**: Leap, Flash, etc. (`plugins/motion.nix`)
  - **UI**: Which-key, indent-blankline, etc. (`plugins/ui.nix`)
  - **Visibility**: Colorizer, todo-comments, etc. (`plugins/visibility.nix`)
  - **Status line**: Lualine (`plugins/lualine/`)
  - **Bufferline**: Buffer tabs (`plugins/bufferline.nix`)
  - **Terminal**: Toggleterm (`plugins/toggleterm.nix`)
  - **Utilities**: Snacks.nvim, img-clip, molten (Jupyter) (`plugins/snacks.nix`, `plugins/img-clip.nix`, `plugins/molten.nix`)
  - **Plugin manager**: dpp.vim configuration (`plugins/dpp/`)
  - **Dependencies**: Required plugins (`plugins/depends.nix`)
  - **Helpers**: Utility plugins (`plugins/helpers.nix`)
  - **Lazy loading**: lz.n (`plugins/lz-n.nix`)
- Colorscheme configuration in `colorscheme.nix`
- Filetype settings in `filetype.nix`
- Extra Lua configuration in `extra_config.lua`

**Git Tools**:
- **git** (`modules/programs/git.nix`): Git configuration
- **gh** (`modules/programs/gh.nix`): GitHub CLI

**Nix Tools**:
- **nh** (`modules/programs/nh.nix`): Nix helper for streamlined operations
- **alejandra** (`modules/programs/alejandra.nix`): Nix code formatter
- **nix-index** (`modules/programs/nix-index.nix`): File database for nix packages
- **direnv** (`modules/programs/direnv.nix`): Directory-specific environment variables

### CLI Utilities

**File Operations**:
- **fd** (`modules/programs/fd.nix`): Modern find replacement
- **ripgrep** (`modules/programs/ripgrep.nix`): Fast grep alternative
- **eza** (`modules/programs/eza.nix`): Modern ls replacement
- **bat** (`modules/programs/bat.nix`): Cat with syntax highlighting
- **tre** (`modules/programs/tre.nix`): Tree command alternative
- **zoxide** (`modules/programs/zoxide.nix`): Smarter cd command

**Other Utilities**:
- **curl** (`modules/programs/curl.nix`): HTTP client
- **gomi** (`modules/programs/gomi.nix`): Safe rm alternative
- **pay-respects** (`modules/programs/pay-respects.nix`): Modern command correction tool

### macOS Services

**AeroSpace** (`modules/services/aerospace.nix`):
- Tiling window manager for macOS
- Comprehensive keybindings (Alt-based)
- Workspace configuration: 1-5 (main monitor), A-E (secondary/main)
- Integration with Sketchybar and JankyBorders
- Configured layouts: tiles, accordion, floating
- Custom gap settings for proper spacing
- Service mode for advanced operations (Alt-Shift-;)

**JankyBorders** (`modules/services/jankyborders.nix`):
- Window border highlighting service
- Launched automatically by AeroSpace

**Sketchybar** (`modules/services/sketchybar/`):
- Custom macOS menu bar
- Integrates with AeroSpace for workspace display
- Launched automatically by AeroSpace

### Homebrew-Managed Applications

Configured in `modules/toplevel/nix-darwin/homebrew.nix`:

**Brews**:
- `mas`: Mac App Store CLI

**Casks**:
- `arc`: Arc browser
- `aquaskk`: Japanese input method (SKK)
- `karabiner-elements`: Keyboard customization

**Mac App Store Apps**:
- XCode (497799835)
- LINE (539883307)

**AquaSKK Configuration**: Custom keymap configuration included in the homebrew module for Japanese input.

### Fonts

Configured in `modules/toplevel/fonts.nix`:
- **udev-gothic-nf**: Main font with Nerd Font icons
- **noto-fonts-cjk-serif**: Japanese serif font
- **noto-fonts-cjk-sans**: Japanese sans-serif font
- **hackgen-nf-font**: Programming font with Nerd Font support

## Code Conventions

### Module Creation

When creating a new program module in `modules/programs/`:

1. **File naming**: `modules/programs/toolname.nix` or `modules/programs/toolname/default.nix`
2. **Module structure**:
   ```nix
   {delib, ...}:
   delib.module {
     name = "programs.toolname";

     options.programs.toolname = with delib; {
       enable = boolOption false;  # Default disabled for opt-in tools
     };

     home.ifEnabled = {cfg, pkgs, ...}: {
       # Configuration here
     };
   }
   ```
3. **Options**: Use Denix option helpers:
   - `boolOption <default>`: Boolean option with default value
   - `strOption <default>`: String option with default value
   - `singleEnableOption <default>`: Shorthand for `{ enable = boolOption <default>; }`
   - `readOnly <option>`: Makes an option read-only (e.g., `readOnly (strOption "value")`)
4. **Conditionals**:
   - `.ifEnabled`: Applied when module's `enable` option is `true`
   - `.ifDisabled`: Applied when module's `enable` option is `false`
   - `.always`: Always applied regardless of `enable` option

### Constants and User Info

User information is centralized in `modules/config/constants.nix`:
- `constants.username = "neo"`
- `constants.userfullname = "Neo Kitani"`
- `constants.useremail = "glassesneo@protonmail.com"`

Reference these in modules rather than hardcoding.

### File Organization

- **Standalone configs**: Small modules go in single `.nix` files
- **Complex configs**: Use directory structure (see `modules/programs/nixvim/`)
- **Auxiliary files**: Place in module directory (e.g., `zsh/zellij.zsh`, `ghostty/cursor_trail.glsl`)

## Common Development Tasks

### Adding a New Program

1. Create `modules/programs/newtool.nix`
2. Define module with `delib.module`
3. Add options and configuration
4. Test with `nh darwin switch . -H kurogane -Lt`

### Modifying Neovim Configuration

Neovim uses nixvim framework in `modules/programs/nixvim/`. See the "Configured Programs and Services > Development Tools > Neovim/Nixvim" section for a complete list of plugin categories and their locations.

Key directories:
- **LSP**: `lsp/` - Language server configurations
- **Plugins**: `plugins/` - Organized by category (ai, editing, ui, etc.)
- **Plugin manager**: `plugins/dpp/` - Denops-based plugin manager with TOML configs
- **Colorscheme**: `colorscheme.nix` - Theme configuration
- **Filetype**: `filetype.nix` - Filetype-specific settings
- **Extra config**: `extra_config.lua` - Additional Lua configuration

After changes, rebuild with `nh darwin switch` to apply new Neovim config automatically.

### Managing MCP Servers

MCP (Model Context Protocol) servers are centrally configured in `modules/programs/mcp-servers/default.nix`. This module manages server configurations for:
- Claude Code
- OpenCode
- Crush
- Neovim (mcphub.nvim)

Each AI tool has its own isolated server configuration with separate memory files to prevent conflicts. When adding or modifying MCP servers:

1. Edit `modules/programs/mcp-servers/default.nix`
2. Add server configuration to the appropriate section(s)
3. For node-based servers, add the package to `node2nix/node-packages.json` first
4. Rebuild to apply changes

Server types:
- **stdio**: Local command execution
- **sse**: Server-sent events (remote servers like DeepWiki)
- **local**: OpenCode's format for local servers
- **remote**: OpenCode's format for remote servers

### Managing Secrets

Uses agenix for encryption:
1. Add secret files to `secrets/`
2. Reference with `config.age.secrets.secretname.path` in modules
3. Secrets are encrypted with host SSH keys

### Updating Dependencies

```bash
# Update all inputs and apply immediately
nh darwin switch . -H kurogane -Lt --update

# Update specific input(s) and apply
nh darwin switch . -H kurogane -Lt --update-input nixpkgs

# Update without applying (just update flake.lock)
nix flake update

# Commit flake.lock if successful
git add flake.lock
git commit -m "update"
```

### Testing Module Changes

```bash
# Quick syntax check
nix flake check

# Dry-run home-manager config only (faster)
nh home switch --dry

# Full darwin system dry-run (includes home-manager)
nh darwin switch . -H kurogane -Lt --dry

# Build without activation (test build success)
nh darwin build . -H kurogane -Lt
```

## Important Implementation Notes

### Nix Experimental Features

This configuration requires (set in `modules/toplevel/nix.nix`):
- `nix-command`: New Nix CLI
- `flakes`: Flake system
- `pipe-operators`: Nix pipe syntax

### Homebrew Integration

macOS apps not available in nixpkgs are managed via Homebrew in `modules/toplevel/nix-darwin/homebrew.nix`. The `brew-nix` input enables declarative Homebrew management.

### XDG Directory Structure

Custom XDG paths are configured in `modules/toplevel/xdg.nix`. Programs should respect these paths:
- Config: `$XDG_CONFIG_HOME`
- Data: `$XDG_DATA_HOME`
- State: `$XDG_STATE_HOME`
- Cache: `$XDG_CACHE_HOME`

### Multi-Target Architecture

Denix supports multi-target configurations allowing modules to define settings for different system types (NixOS, Home Manager, nix-darwin) in a single module definition.

**Platform-specific blocks**:
- `home.ifEnabled`: Home Manager configuration (user-level)
  - When `moduleSystem = "home"`: Applied to `config`
  - When `moduleSystem = "darwin"` or `"nixos"`: Applied to `config.home-manager.users.neo` (if Home Manager module is enabled)
- `darwin.ifEnabled`: nix-darwin configuration (macOS system-level)
  - Applied to `config` only when `moduleSystem = "darwin"`
- `nixos.ifEnabled`: NixOS configuration (system-level)
  - Applied to `config` only when `moduleSystem = "nixos"` (not used in this repo)

**Usage guidelines**:
- User programs, dotfiles → `home.ifEnabled`
- System settings, services → `darwin.ifEnabled`
- Both when needed (e.g., fonts, environment variables)

**Host definitions**:
The `delib.host` function defines machine-specific configurations. For this repo:
```nix
delib.host {
  name = "kurogane";
  type = "desktop";
}
```

Hosts require defining options `${myconfigName}.host` and `${myconfigName}.hosts` in your modules. Configurations are conditionally applied when `config.${myconfigName}.host` matches the host's `name`.

### Git Workflow

Repository uses conventional commits with "update" messages for dependency bumps. Remote is at `github.com/glassesneo/dotfiles`.
