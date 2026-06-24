# Evaluation Task Template

Create at least 3 evaluation tasks covering the 3 categories below. `lint_skill.py` only checks whether a file with an eval-like name, such as `*eval*`, exists under `references/`, and mechanically counts the number of `##` headings. A human must judge whether the task content is valid.

## 1. Positive Trigger Test

```markdown
### Positive Test 1
Input (user utterance): "<realistic user utterance>"
Expected: This skill activates.
Verification method: <How to verify it. Example: compare against trigger terms listed in `available_skills` in the system prompt, or run the utterance and observe routing behavior.>
```

Prepare at least 2 to 3 positive trigger tests. Include both formal and casual phrasing.

## 2. Negative Trigger Test

```markdown
### Negative Test 1
Input (user utterance): "<utterance for a neighboring skill or unrelated task>"
Expected: This skill does not activate, or neighboring skill X activates instead.
Reason: <Why this skill must not activate. State the boundary condition.>
```

Include at least one negative test that shares similar surface vocabulary but is out of scope. This checks that the skill does not activate from keyword overlap alone.

## 3. Execution Test: Input → Expected Behavior → Pass Condition

```markdown
### Execution Test 1
Input: <specific input data or situation>
Expected behavior: <summary of the steps the skill should take>
Pass condition: <observable pass condition, such as output file existence, a specific field value, or exit code>
```

For skills that generate artifacts such as files, also include the following checks.

```markdown
### Syntax Check
Target file: <output file>
Verification method: <specific command that verifies there are no syntax errors with a parser or linter>

### Diff Check
Comparison target: <before/after comparison or expected output comparison>
Allowed differences: <Differences that may be ignored. If none, write "exact match".>
```

---

## Filled Example: `skill-architect`

### Positive Test 1

Input: "I want to create a new skill."

Expected: `skill-architect` activates.

Verification method: Confirm that "create a skill" or equivalent trigger wording appears in the description trigger examples.

### Negative Test 1

Input: "I want to manage a Nix flake named skill. What file structure should I use?"

Expected: `skill-architect` does not activate, even though the utterance includes the word "skill".

Reason: The target domain is Nix configuration itself, not the design quality of an Agent Skill or `SKILL.md`.

### Execution Test 1

Input: "I keep asking the agent to explain Zig build steps, so I want to turn that into a skill."

Expected behavior: Execute steps 0 through 14 in order and produce a complete `zig-build-guide/` directory.

Pass condition: `scripts/lint_skill.py zig-build-guide` exits with 0 FAIL items.
