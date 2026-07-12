# Documentation Policy

This file is the canonical policy for documentation ownership and placement.

## Document roles

- **Normative documentation** defines durable rules and required boundaries.
  `docs/denix-architecture.md` is the sole canonical architecture contract;
  this file is the canonical documentation contract.
- **Descriptive documentation** orients readers to the current repository
  without creating rules. `README.org` is the concise human landing page.
- **Operational documentation** gives a safe procedure for a concrete task.
  Put cross-cutting runbooks in `docs/` and subsystem runbooks beside their
  owning source.
- **Local-contract documentation** records durable, non-obvious constraints for
  one subtree. Use a local `README.md` for human operation and `AGENTS.md` for
  agent-facing decision rules.

Source comments own invariants that are easiest to keep correct beside the
implementation.

## Canonical ownership

Every durable statement has one canonical owner. Other documents may summarize
only what their audience needs and must point to that owner for the complete
rule. When a rule changes, update its owner first and remove contradictory or
duplicated text in the same change.

Document a fact when it is stable and at least one of these applies: omitting it
could cause unsafe or invalid changes; behavior is not evident from source; a
workflow needs an authoritative owner; or repeated rediscovery is costly.
Avoid volatile inventories, temporary migration notes, command-help copies, and
facts obvious from nearby source.

## Placement

- Keep the root `README.org` focused on human orientation and first commands.
- Keep root and local `AGENTS.md` files focused on agent-facing constraints and
  local deltas; do not copy architecture policy into them.
- Use `docs/` for stable cross-cutting contracts and runbooks.
- Colocate subsystem operations and contracts with their concrete owner.
- Prefer comments for file-local invariants and external-tool workarounds.

Documentation stays physically flat by default. Create a nested document only
when a concrete subsystem is its owner; do not create another root guidance file
when an existing owner can hold the content.

## Maintenance checks

- Verify links and referenced paths when editing documentation.
- Check references before deleting or moving a document.
- State the audience and owner implicitly through the selected role and
  location; do not duplicate a repository manual to make a local file complete.
- Keep operational commands aligned with the source and encrypted-file model
  they operate on.

Current operational owners include `docs/secrets-key-rotation.md` and
`modules/programs/aquaskk/README.md`. Host tier semantics are described in
`docs/host-tiers.md`.
