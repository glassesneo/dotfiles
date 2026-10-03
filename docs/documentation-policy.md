# Documentation Policy

This file owns what the repository documents, where each kind of statement lives, and when documentation changes.

## Premise

This repository holds a framework and the modules that use it. The framework — its layers, ownership boundaries, and command contracts — changes rarely and deliberately. Modules and hosts hold choices: a colorscheme, a default shell, a package. Those change constantly, and are meant to.

A document that follows every choice is never finished, and a document that is never finished cannot be trusted. Documentation therefore records only what stays true when a choice changes. Everything else is for the code to say.

## What is documented

A statement is documented when both hold:

- It stays true when any single value is swapped: another colorscheme, another default shell, another host.
- It is not evident from the code it concerns.

Typical subjects are which directory owns which concern, what a layer may and may not do, how a repository mechanism behaves, how a command behaves, and what a change must keep true.

Only written contracts are contracts. What no document states is not a gap: the existing code is correct as it stands, and its absence from documentation is not a reason to add it. Adding a contract is a judgment made against the criteria above, and a statement that does not clearly meet them is not added.

## Where statements live

- `docs/architecture.md` owns the structure of the repository: composition, Denix concepts, directory ownership, and an index of repository mechanisms. It names each mechanism in one sentence and leaves its behavior to the mechanism's owner.
- A repository mechanism — an extension, an adapter contract, a `lib/` helper — is specified beside its implementation: a comment at the top of the file, the `description` of each option it declares, and the checks under `tests/` that exercise it.
- `docs/commands.md` owns operator commands and their effects on state.
- `README.org` orients humans and lists first commands; it points to owners instead of restating them.
- `AGENTS.md` holds agent-facing decision rules that no other owner covers; apart from the summary allowed under Ownership, it does not restate other documents.

Option descriptions are documentation and meet the same criteria.

A comment explains why the code beside it is not obvious: a workaround, an ordering constraint, an upstream quirk. It may concern a single choice, because it lives and changes with that code. It does not restate a contract owned elsewhere.

## When documentation changes

Documentation changes when a change alters a documented contract, and in the same change, so that code and documentation never disagree.

A change that leaves every documented contract true leaves the documentation alone. This holds wherever the change lands: adapters, extensions, scripts, and commands included. In particular, documentation does not change for:

- a value: adding, changing, or removing a choice inside a module or host;
- an implementation, fix, or refactor that keeps the documented contract true;
- facts of a kind the documentation never records, such as inventories, current defaults, copies of command help, or migration notes.

A comment changes only when the code it explains changes.

## Ownership

Every documented statement has one owner. Other documents point to the owner instead of repeating the statement. When a contract changes, update its owner first and remove any text that now disagrees with it.

The one exception is `AGENTS.md`, which agents load by default. It may summarize the concepts of `docs/architecture.md` that a conversation assumes, and points there for the rules. The summary changes in the same change as the statements it summarizes.

Each document and each specifying source file states at its top what it owns. A statement outside every declared scope has no owner; propose an owner to the user instead of adding the statement.
