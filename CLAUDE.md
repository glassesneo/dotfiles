# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Nix-based modular dotfiles repository using **Denix** to manage both Home Manager (user environment) and nix-darwin (macOS system) configurations. The architecture enables declarative, reproducible system configuration with clear separation between personal settings, program configurations, and system-level settings.

**Host**: `kurogane` (desktop machine)
**User**: `neo`

## Build and Deployment Commands

### Applying Configurations

**Home Manager (user environment only)**:
```bash
# From nix-community/home-manager
nix run github:nix-community/home-manager -- switch --flake .#neo

# Or using local flake output
nix run .#homeConfigurations.neo.activationPackage
```

**nix-darwin (macOS system configuration)**:
```bash
# Standard rebuild
darwin-rebuild switch --flake .#kurogane

# Or direct flake execution
nix run .#darwinConfigurations.kurogane.system
```

**Both together** (typical workflow):
```bash
darwin-rebuild switch --flake .#kurogane  # Applies both darwin and home-manager configs
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
```

### Node Package Management

When modifying `node2nix/node-packages.json`:
```bash
# Regenerate nix expressions from node-packages.json
cd node2nix
nix-shell -p node2nix --run "node2nix --input node-packages.json --output node-packages.nix --composition default.nix"
```

Current node packages include MCP servers (Brave Search, Tavily, Readability, Chrome DevTools) and AI tools (Claude Code, Jules, Gemini CLI).

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
│   ├── services/          # System services (sketchybar)
│   └── toplevel/          # System-level settings (nix-darwin, nixpkgs, xdg, fonts)
├── node2nix/              # Node.js package management
└── secrets/               # Encrypted secrets (agenix)
```

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
- **mcp-hub**, **mcp-servers-nix**: Model Context Protocol integrations

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
3. **Options**: Use Denix option helpers (defined in `lib/options.nix`):
   - `boolOption <default>`: Boolean option with default value
   - `strOption <default>`: String option with default value
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
4. Test with `darwin-rebuild switch --flake .#kurogane`

### Modifying Neovim Configuration

Neovim uses nixvim framework in `modules/programs/nixvim/`:
- **LSP**: `lsp/` directory
- **Plugins**: `plugins/` directory (organized by category)
- **AI integration**: `plugins/ai/` (Claude Code, CodeCompanion)
- **Plugin manager**: `plugins/dpp/` (Denops-based, TOML configs)
- **Extra Lua**: `extra_config.lua`

After changes, rebuild applies new Neovim config automatically.

### Managing Secrets

Uses agenix for encryption:
1. Add secret files to `secrets/`
2. Reference with `config.age.secrets.secretname.path` in modules
3. Secrets are encrypted with host SSH keys

### Updating Dependencies

```bash
# Update all inputs
nix flake update

# Test changes
darwin-rebuild switch --flake .#kurogane

# Commit flake.lock if successful
git add flake.lock
git commit -m "update"
```

### Testing Module Changes

```bash
# Quick syntax check
nix flake check

# Test home-manager config only (faster)
nix run github:nix-community/home-manager -- switch --flake .#neo --dry-run

# Full system dry-run
darwin-rebuild build --flake .#kurogane
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
