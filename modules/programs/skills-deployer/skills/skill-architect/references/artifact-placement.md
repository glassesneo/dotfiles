# Artifact Placement

## Purpose

Use this reference to decide what belongs in `SKILL.md`, `references/`, `assets/`, and `scripts/`.

## Placement Rule

Put instructions where the future agent needs them at execution time.
Do not hide required behavior in optional files.

## SKILL.md

`SKILL.md` contains always-needed behavioral instructions.

Put these in `SKILL.md`:

- purpose
- use cases and non-use cases
- receiver assumptions
- required inputs and allowed assumptions
- workflow
- output contracts
- safety boundaries
- when to read references
- when to use assets or scripts

Example: execution workflow -> `SKILL.md`.

## references/

`references/` contains optional depth used for some tasks.

Put these in references:

- description writing patterns
- overlap audit criteria
- artifact placement examples
- evaluation case patterns
- domain research summaries that are not always needed

Example: description pattern -> reference.
Example: domain background -> reference only when needed.

References are optional extensions, not hidden required instructions.

## assets/

`assets/` contains reusable source material that may be copied or adapted.

Put these in assets:

- templates
- skeleton files
- example config files
- sample prompts
- fixtures

Example: template -> asset.

Assets are not the place for secret instructions.
If an instruction is required to use the skill, put it in `SKILL.md`.

## scripts/

`scripts/` contains executable helpers only when they are tested and maintained.

Put these in scripts:

- linters
- validators
- packaging helpers
- migration scripts

Example: linter -> script only if tested.

Do not include scripts as documentation.
Do not add placeholder scripts.
If a script is not executable, tested, and worth maintaining, move its logic into `references/` or remove it.

## Hidden-Instruction Anti-Patterns

Avoid these patterns:

- Required workflow steps only in a reference file.
- Required output format only in a template asset.
- Policy text spread across many files with no execution contract in `SKILL.md`.
- A script that documents checks but cannot run them.
- A large asset that silently changes the skill's behavior.

## Trust Placement Rules

Treat copied, generated, or third-party skill material as untrusted until reviewed.

- Put required behavior in `SKILL.md`, where future agents can inspect it directly after skill selection.
- Keep references and assets aligned with the stated skill purpose.
- Do not place secrets, credentials, private endpoints, or local-only operational details in a reusable skill package.
- Make any network access, file mutation, or destructive side effect explicit in `SKILL.md` and in script documentation.
- Remove or rewrite material that tries to override the skill's stated purpose from a reference, asset, or example.

## Placement Examples

| Material | Place it in | Reason |
| --- | --- | --- |
| Core workflow | `SKILL.md` | Always needed after skill selection. |
| Frontmatter description examples | `references/` | Useful only for description-writing tasks. |
| Thin skill skeleton | `assets/` | Copyable starting material. |
| Tested validator | `scripts/` | Executable helper with maintained behavior. |
| Untested validator idea | `references/` or remove | Not safe as a script. |
| Domain background | `references/` | Optional context, not core execution. |
