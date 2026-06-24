---
name: skill-architect
description: "Use this skill to design and create a new Agent Skill package (`SKILL.md` plus any required `references/`, `scripts/`, and `assets/`), or to review and revise an existing skill's responsibility, description trigger, procedure, and safety boundaries. Always use this skill for requests such as 'I want to create a skill', 'fix this skill', 'improve this skill's trigger/description', 'check whether these skills overlap', or 'review this skill'. Do not use it to research or explain the subject matter handled by another skill, such as teaching how to use a tool or writing code directly. Do not use it for one-off README or documentation tasks that do not need the skill format."
---

# Skill Architect

Use this skill to design and create a complete Agent Skill package, or to audit and revise an existing skill. The target is the design quality of the skill artifact itself, not explanation of the domain knowledge that the skill handles.

## Responsibility of This Skill

* Run the creation process for a new skill.
* Review and revise an existing skill, including its trigger description.
* Resolve responsibility overlap between multiple skills by deciding whether to merge, split, or replace them.

Out of scope:

* Researching, explaining, or implementing the target domain handled by the skill, such as teaching Nix syntax or writing code. That is the job of the generated skill itself.
* Creating a one-off README or document when the user did not ask for a skill.
* Updating this skill automatically without approval. Any revision proposal must be applied only after human approval.

## Input and Output Contract

Inputs to collect:

* The skill purpose in one sentence.
* Expected trigger utterances, including both positive and negative examples.
* Input and output formats.
* Relationship to existing skills, including overlap and neighboring responsibilities.
* Whether destructive operations are involved.
* Expected execution environment, including OS, CLI, MCP, network access, and intended model class.

Outputs to produce:

* A complete `skill-name/` directory. `SKILL.md` is required. Add `references/`, `scripts/`, and `assets/` when needed.
* At least 3 evaluation tasks: positive trigger test, negative trigger test, and execution test.
* Self-audit result from `scripts/lint_skill.py`.

Completion condition: Step 13 self-audit returns 0 FAIL items, and the user approves the content. Subjective approval such as "looks good" is not sufficient by itself.

## Overall Process

Follow the steps in order by default. If the user asks to see only an early draft first, complete steps 0 through 6 and show the draft. Each step distinguishes decisions that require user confirmation from decisions that may be made automatically.

### Step 0: Lock the Purpose in One Sentence

Ask the user to state what the skill does in one sentence.

* If it does not fit in one sentence: treat that as a sign of excessive responsibility. Propose a split and ask which skill to create first.
* If it fits in one sentence: proceed to Step 1.

### Step 1: Check for Overlap with Existing Skills

Inspect the available skill list under `/mnt/skills` or the user's managed skills directory.

* If a similar skill exists: ask the user whether to merge, split, or replace before proceeding. Do not decide to create a new skill immediately.
* If no similar skill exists: proceed to Step 2.

### Step 2: Decide the Name

* Use kebab-case with only ASCII letters, numbers, and hyphens.
* Use a task name, not a domain name or persona name. Prefer a name that shows the action, such as `nix-flake-bootstrap`, instead of a broad name like `nix-helper`.
* Check for collisions with existing skill names, including skills under `/mnt/skills`.

### Step 3: Design the Description Trigger Contract

Write the description as a routing contract used for skill selection, not as general explanatory prose. Include:

1. What the skill does, in the first sentence.
2. When to use it, with example trigger utterances and search terms placed early.
3. When not to use it, including boundaries with neighboring skills and explicit out-of-scope cases.

Forbidden patterns:

* Empty marketing terms such as "best", "ultimate", or "perfect".
* Placing the main trigger conditions late in the description.
* Omitting non-use conditions.

See `references/description-patterns.md` for good and bad examples.

### Step 4: Define the Input and Output Contract

* List accepted inputs.
* List generated outputs and fix their formats.
* If the skill creates files, specify file names, locations, formats, and update conditions. Forbid opaque names such as `doc1.md`; use content-revealing names such as `acceptance-criteria.md`.
* Separate conditions that require user confirmation from conditions that do not.
* Write completion criteria in observable terms, such as "`lint_skill.py` returns 0 FAIL items", not subjective terms such as "the user is satisfied".

### Step 5: Write the Procedure

* Use imperative instructions.
* Write one action per step.
* Use If / Then / Else for decision branches.
* Put exception handling after the normal procedure, in a separate section.
* Do not use vague terms such as "appropriately", "as needed", or "make it good". Replace them with the actual decision criteria. See `references/vague-words.md`.
* For important operations, write both a pre-check and a post-check.

### Step 6: Design Context with Progressive Disclosure

* Keep the main `SKILL.md` within roughly 500 lines.
* Move long background material, large example sets, and templates into `references/`.
* Put directly reusable output files, such as templates or icons, in `assets/`.
* Do not repeat the same rule in multiple places. Use one term consistently for one concept.
* Whenever an abstract explanation is included, pair it with the concrete action the agent must take.

### Step 7: Specify Tools, Environment, and Dependencies

* Name the exact CLI, MCP, or API to use. Do not rely on vague category names.
* Do not assume tools are installed. Provide check commands.
* Specify network access, file access, and OS differences.
* Do not mix path styles from different operating systems, such as Windows paths and Unix paths.

### Step 8: Design Scripts Only When Needed

* First decide whether instruction-only guidance is sufficient.
* Use scripts only for deterministic mechanical work, such as syntax checks, format conversion, repeated transformations, or external API calls.
* Do not push decisions that should be made by the LLM into scripts.
* Specify inputs, outputs, and failure messages.
* Specify dependency packages and execution mode, including whether the script is run or only read as reference.
* If a magic number is used, explain its reason in a comment.

### Step 9: Design Safety Boundaries

* Separate read operations from write operations.
* List all state-changing actions, such as deletion, sending, billing, publishing, or permission changes.
* Add confirmation conditions for destructive operations. If any operation may proceed without confirmation, state that condition explicitly.
* Specify how secrets, tokens, and personal information are handled. Do not leave them in logs or generated artifacts.
* Do not treat third-party skills or external code as trusted by default.
* If the skill has no destructive operations, explicitly write "No destructive operations". Do not omit this section.

### Step 10: Account for Model Differences

* Ask the user which execution model class is intended, such as a lightweight model or a high-capability model.
* For lightweight models, make procedures and output contracts more explicit.
* Remove excessive general explanation that high-capability models are already expected to know.

### Step 11: Create Evaluation Tasks

Create at least these 3 task types:

1. **Positive trigger test**: an utterance that should activate this skill, plus how to verify activation.
2. **Negative trigger test**: an utterance that should not activate this skill, including boundaries with neighboring skills.
3. **Execution test**: input → expected behavior → pass condition.

For skills that generate files or other artifacts, add syntax checks and diff checks. Use `references/eval-template.md`.

### Step 12: Check User Comprehensibility

* Confirm that representative input and output examples are included.
* Confirm that the skill's limits are explicit.
* Confirm that a user can run the skill for the first time without reading helper code.

### Step 13: Run Self-Audit with the Bad Practice Checklist

Run `scripts/lint_skill.py`.

```bash
python3 scripts/lint_skill.py path/to/skill-name
```

* If any FAIL item appears, return to the corresponding step, revise, and rerun the audit.
* Show WARN items to the user and ask whether to accept them. WARN items are heuristic and may include false positives.
* Also manually compare all items with `references/bad-practice-checklist.md`.

### Step 14: Output the Result

* Show the final directory structure.
* If needed, package the skill with `scripts/package_skill.py`.

```bash
python3 scripts/package_skill.py path/to/skill-name
```

* Present the generated artifact and confirm the installation destination, such as `~/.claude/skills/` or the project's `.claude/skills/`.

## Revision After Release

Treat the first version as a hypothesis. Revise it after observing execution logs and failure cases. For each revision, record these 4 items separately: failure cause / changed location / expected behavior change / revalidation method. Distinguish whether the fix changes `SKILL.md`, a reference file, or a script. Prioritize preserving existing behavior that already works.

## Tone

* Enforce one function per skill. Do not create convenient generic skills.
* Do not accept "looks good" as enough. Force decision criteria and observable pass conditions to be written down.
* Even when the user is in a hurry, do not skip Step 0, purpose in one sentence, or Step 3, description design. If these are weak, the skill will not function.
* Prefer concrete If/Then examples over long explanations.
