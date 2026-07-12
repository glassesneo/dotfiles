# Denix Architecture Contract

This is the canonical architecture contract for the repository. Read it before
changing ownership or structure under `hosts/`, `modules/`, or `rices/`.

## Discovery constraints

Denix auto-discovers every `.nix` file below `hosts/`, `modules/`, and `rices/`.
Files in those trees must not build cross-module manual import chains. Flakes
also see only git-tracked files, so a new file must be staged before evaluating
or building a configuration that depends on it.

## Directory owners

- `hosts/` owns machine facts and host-only bindings, including platform,
  capabilities, tier, hardware, and explicit host overrides.
- `modules/config/` owns shared data, registries, constants, and helper exports.
- `modules/programs/` owns user-facing program integration.
- `modules/services/` owns desktop and long-running service integration.
- `modules/toplevel/` owns broad system/user policy and shared integration
  surfaces.
- `rices/` owns ricing-oriented desktop-experience policy and selection data.

The directory identifies the physical owner; the role below identifies what an
expression is doing.

## Architecture roles

- A **feature owner** defines a typed interface and translates it to packages,
  upstream options, imports, scripts, activation, assertions, and
  platform-specific behavior.
- An **aggregation owner** is the sole final writer for a shared target to which
  several features contribute. Keep it with the narrowest subsystem that owns
  that target; use `modules/toplevel/` only for genuinely broad integration.
- A **host override** is an explicit machine-specific choice. It takes
  precedence over a rice-provided normal selection.
- A **shared data owner** provides data or helpers without performing end-user
  feature wiring.
- A **rice policy selector** chooses repository-owned typed policy. It does not
  implement the selected behavior.

For example, AquaSKK contributes input-source entries through
`modules/toplevel/nix-darwin/system/ime.nix`; the IME module alone writes the
shared HIToolbox arrays.

## Rice and feature boundary

Rices may select visual appearance and appearance-related desktop behavior,
including the normal window-manager backend. They may assign only typed
`myconfig` interfaces owned by this repository.

Rices must not import upstream modules, assign Home Manager or nix-darwin
options directly, resolve packages, contain plugin-specific implementation,
provide runtime or activation wiring, or implement platform behavior. The
feature that exposes a rice-facing option owns all such translation. Explicit
host settings may override rice selections.

## Change classes

Classify each declarative change as one of these:

1. **Configuration change within an interface** — changes a value or behavior
   already represented by an owned typed interface. Keep it with that owner.
2. **Interface evolution under the same owner** — changes the typed interface
   without changing responsibility. Update its consumers, validation, and local
   documentation together.
3. **Architecture change** — moves responsibility, changes an ownership
   boundary, or introduces/removes cross-subsystem aggregation. Complete the
   checklist below before finalizing it.

## Architecture-change checklist

- Name the current owner, proposed owner, and reason the boundary must change.
- Identify the single typed interface and the single final upstream writer.
- Check whether a subsystem-local aggregation owner is sufficient.
- Trace existing consumers and preserve deliberate host-over-rice precedence.
- Confirm that no manual import is introduced in a Denix discovery tree.
- Update this contract only when the durable architecture rule itself changes;
  put implementation details with the feature owner.
- Evaluate representative affected hosts and variants after staging new files.

## Placement guide

Put machine-only facts in `hosts/`, reusable program or service behavior in its
feature module, shared pure data in `modules/config/`, broad or multi-feature
integration in the appropriate aggregation owner, and rice selections in
`rices/`. A child module is useful only when disabling the child represents a
meaningful choice and leaves its parent valid.

Related policy: `docs/documentation-policy.md`.
