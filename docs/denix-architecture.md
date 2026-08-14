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
  capabilities, tier, hardware, and explicit machine policy.
- `modules/config/` owns shared data, registries, constants, and helper exports.
- `modules/system/` owns host-wide OS policy and translates that policy to
  platform-specific system options.
- `modules/user/` owns broad user-environment policy that can be applied fully
  by standalone Home Manager.
- `modules/programs/` owns application integration.
- `modules/services/` owns desktop, background, and long-running runtime service
  integration.
- `modules/toplevel/` owns module-system adapters and genuinely cross-cutting
  final integration surfaces.
- `rices/` owns ricing-oriented desktop-experience policy and selection data.

A directory identifies concern ownership, not an evaluation layer. Standalone
Home Manager includes a module's `home` output; `darwin` and `nixos` outputs
remain with the same concern owner when that concern also needs system wiring.

The directory identifies the physical owner; the role below identifies what an
expression is doing.

## Architecture roles

- A **feature owner** defines a typed interface and translates it to packages,
  upstream options, imports, scripts, activation, assertions, and
  platform-specific behavior.
- An **aggregation owner** is the sole final writer for a shared target to which
  several features contribute. Keep it with the narrowest subsystem that owns
  that target; use `modules/toplevel/` only for genuinely broad integration.
- A **host policy** is an explicit machine-specific choice. Keep it disjoint
  from rice-selected policy; module source order does not establish precedence.
- A **shared data owner** provides data or helpers without performing end-user
  feature wiring.
- A **rice policy selector** chooses repository-owned typed policy. It does not
  implement the selected behavior.

For example, AquaSKK contributes input-source entries through
`modules/system/input-methods.nix`; the input-methods module alone writes the
shared HIToolbox arrays.

## Rice and feature boundary

Rices may select visual appearance and appearance-related desktop behavior,
including the normal window-manager backend. They may assign only typed
`myconfig` interfaces owned by this repository.

Rices must not import upstream modules, assign Home Manager or nix-darwin
options directly, resolve packages, contain plugin-specific implementation,
provide runtime or activation wiring, or implement platform behavior. The
feature that exposes a rice-facing option owns all such translation. Hosts and
rices must not rely on source order to resolve assignments to the same typed
policy path; keep their policy disjoint, or use an explicit Nix module priority
when a documented machine exception requires a collision.

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
- Trace existing consumers and eliminate unintended host/rice policy collisions;
  document any collision resolved by an explicit Nix module priority.
- Confirm that no manual import is introduced in a Denix discovery tree.
- Update this contract only when the durable architecture rule itself changes;
  put implementation details with the feature owner.
- Evaluate representative affected hosts and variants after staging new files.

## Placement guide

Put machine-only facts in `hosts/`, host-wide OS policy in `modules/system/`,
standalone Home Manager user policy in `modules/user/`, reusable application or
service behavior in its concern owner, shared pure data in `modules/config/`,
and rice selections in `rices/`. Put module-system adapters and only genuinely
cross-cutting final integration in `modules/toplevel/`. A child module is useful
only when disabling the child represents a meaningful choice and leaves its
parent valid.

Related policy: `docs/documentation-policy.md`.
