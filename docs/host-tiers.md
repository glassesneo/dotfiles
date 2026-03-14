# Host Performance Tiers

## What a tier represents

A tier is a single ordered label that describes a host's overall performance capability. Modules use it to decide what to install or enable based on how much the machine can handle.

## Tier values

The supported values, from least to most capable:

1. `minimal` -- headless or heavily constrained environments
2. `basic` -- low-power machines with limited resources
3. `standard` -- typical workstations (schema default)
4. `full` -- high-end machines that can run everything

Hosts that do not set `tier` default to `standard`.

## Where the tier is declared

Each host sets its tier in its Denix host definition:

```nix
# hosts/<name>/default.nix
delib.host {
  name = "kurogane";
  type = "laptop";
  rice = "monochrome";
  tier = "full";
}
```

The `tier` option is defined as a Denix host schema extension via `hosts.extraSubmodules` in `flake.nix`.

## How modules consume tiers

Modules receive two args through the shared-arg pattern:

- `host.tier` -- the raw tier string for the current host
- `tiers` -- an attrset of ordered-comparison helpers

### The `tiers` helper API

| Helper | Signature | Description |
| --- | --- | --- |
| `tiers.ordered` | `[string]` | The ordered list: `["minimal" "basic" "standard" "full"]` |
| `tiers.rank` | `tier -> int` | Returns the integer rank (0-3) |
| `tiers.atLeast` | `current -> minimum -> bool` | True when `current >= minimum` |
| `tiers.atMost` | `current -> maximum -> bool` | True when `current <= maximum` |

### Example usage in a future module

```nix
{delib, host, tiers, ...}:
delib.module {
  name = "programs.heavy-tool";

  options = delib.singleEnableOption (tiers.atLeast host.tier "standard");

  home.ifEnabled.programs.heavy-tool.enable = true;
}
```

This enables the program by default only on `standard` or `full` hosts.

## Non-goals

- This framework does not change any existing module behavior. Modules must explicitly opt in to tier-aware logic.
- The tier is a manual declaration, not auto-detected from hardware.
- The four-tier enum is intentionally small. Expand only if real use cases demand it.

## Implementation files

- Schema extension: `flake.nix` (`hosts.extraSubmodules`)
- Helper export: `modules/config/host-tier.nix`
- Host value: `hosts/kurogane/default.nix`
