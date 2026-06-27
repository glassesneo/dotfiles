# Denix Architecture Guide

## Audience

This guide is for coding agents and maintainers who need to
understand how this repository uses Denix to organize configuration and module
boundaries.

Read this after `README.org` and before making structural changes under
`hosts/`, `modules/`, or `rices/`.

## Core Model

Denix auto-discovers `.nix` files under `hosts/`, `modules/`, and `rices/`.
That means this repository is organized around ownership boundaries, not around
hand-written import trees.

Repository-critical consequences:

- Do not manually stitch modules together across those discovery trees.
- Flakes only evaluate git-tracked files, so new files must be staged before
  builds or checks.
- Rices stay data-oriented. Modules own package resolution, platform-specific
  wiring, and assertions.

When you edit this repo, first classify the change:

- host fact or host-only binding
- reusable feature module
- shared data or registry
- system/user aggregation root
- theme data

That classification usually tells you where the code belongs.

## Tree Ownership

### `hosts/`

Owns machine-specific facts and host-only bindings.

Typical contents:

- platform and host tier
- default rice selection
- hardware files
- host-specific secret bindings

Put code here only when it should vary by machine and should not be reused.

### `modules/`

Owns reusable functionality. This tree is divided by responsibility.

#### `modules/config/`

Shared data, registries, constants, and helpers.

Use this for:

- color registries
- constants and shared user metadata
- package helper registries
- shared arguments exposed through `myconfig.always.args.shared.*`

Avoid placing end-user feature wiring here.

#### `modules/programs/`

User-facing tools and applications.

Use this for:

- terminal and editor configuration
- CLI tools
- AI coding tools
- app-specific wrappers and settings

A program module should own the wiring for that tool. Optional subfeatures can
be nested under the same namespace when they are meaningful on their own.

#### `modules/services/`

Desktop services and long-running user/system integrations.

Use this for:

- bar and desktop UI services
- window managers
- background automation services

Services often own event wiring, runtime scripts, and service-local assertions.

#### `modules/toplevel/`

Broad system/user wiring and aggregation roots.

Use this for:

- Nix and nixpkgs policy
- Home Manager and nix-darwin glue
- fonts and shell-wide wiring
- secrets declarations
- shared aggregation interfaces such as IME registration

If multiple feature modules need to contribute values into one shared OS/user
surface, the aggregation root belongs here.

### `rices/`

Theme data and theme selection only.

Rices should set values, not resolve packages or implement platform behavior.
If a rice needs a configurable theme hook, the module should expose a data-shaped
option and interpret it internally.

## Splitting Heuristics

Do not split a module only because it is large. Split when the boundary matches
a real feature or ownership seam.

Use this checklist.

### Split into a child module when all of these are true

- the child has an independent user intent
- disabling the child is meaningful
- the parent remains valid without the child
- the child mainly extends the parent's settings or behavior

Good fit:

- `programs.nixvim.plugins.orgmode` as the base plugin owner
- `programs.nixvim.plugins.orgmode.inbox` as an optional capture workflow
- `programs.nixvim.plugins.orgmode.journal` as an optional journal workflow

### Keep logic in one module when most of these are true

- the code is only an implementation detail
- disabling one part would produce a broken or nonsensical configuration
- the pieces change together almost every time
- the “child” would not represent a real user-facing capability

Good example:

- splitting a renderer helper away from its only owning module does not buy a
  meaningful `enable` boundary

### Prefer an aggregation interface when many features feed one shared target

Use a toplevel aggregation root when:

- multiple modules need to contribute values
- direct writes from feature modules would compete or duplicate logic
- the target surface is shared OS/user state

Examples in this repo:

- IME registration is centralized in `modules/toplevel/nix-darwin/system/ime.nix`
- feature modules such as AquaSKK contribute through that interface instead of
  editing the HIToolbox state directly

### Keep data separate from wiring

Use `modules/config/` or `rices/` when the content is declarative data. Use
feature modules when the content needs packages, activation logic, runtime
scripts, or platform-specific behavior.

## Reference Patterns

### Minimal leaf module

Use a single module when the feature is self-contained and has no meaningful
child features.

Reference: `modules/programs/fd.nix`

### Parent plus optional child feature

Use a parent module for shared ownership, then child modules for optional
workflows that depend on parent state.

References:

- `modules/programs/nixvim/plugins/orgmode/default.nix`
- `modules/programs/nixvim/plugins/orgmode/inbox/default.nix`
- `modules/programs/nixvim/plugins/orgmode/journal/default.nix`
- `modules/programs/ghostty/default.nix`
- `modules/programs/ghostty/quick-terminal/default.nix`

### Base module plus environment-specific overlay

Use this when a base tool is always present, but one context-specific extension
should be toggled separately.

Reference:

- `modules/programs/git/default.nix`
- `modules/programs/git/work.nix`

### Aggregation root plus contributors

Use this when many modules contribute to one shared surface.

References:

- `modules/toplevel/nix-darwin/system/ime.nix`
- `modules/programs/aquaskk/default.nix`

### Pure theme data

Keep theme choice and palette data in data-oriented locations. Modules consume
the selected values.

References:

- `modules/config/colorschemes/`
- `rices/`

## Decision Procedure

When you need to place or split code, answer these in order.

1. Is this host-specific, reusable, aggregating, or theme data?
2. Does this need packages, activation logic, or runtime wiring?
3. Would a child `enable = false` represent a useful user choice?
4. Does this belong under an existing parent that already owns the shared state?
5. Is there already an aggregation interface for this target?

Common outcomes:

- host-specific answer -> `hosts/`
- reusable end-user feature -> `modules/programs/` or `modules/services/`
- shared registry or constants -> `modules/config/`
- shared system/user integration root -> `modules/toplevel/`
- pure theme values -> `rices/`

## Reading Path For Agents

Use this order when entering the repo cold:

1. `README.org` for the repository overview
2. this guide for Denix-specific architecture and splitting rules
3. the nearest local `AGENTS.md` for subtree-local constraints
4. the target module and one reference pattern from this guide

## Related Docs

- Canonical doc policy: `docs/documentation-policy.md`
- Root agent entry: `AGENTS.md`
- Module subtree router: `modules/AGENTS.md`
- Rice-specific constraints: `rices/AGENTS.md`
