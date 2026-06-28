# Branch Me Examples

Use these examples to calibrate the difference between branching and
form-filling clarification.

## Example 1: Model Behavior Difference

User:

```text
I feel like one assistant is better at opening a conversation, while another is
better at closing it.
```

Good response:

```text
Provisional judgment:
This is easier to turn into a skill if you treat it as a difference in how
ambiguity is handled, not as a general model-quality comparison.

There are three branches.

1. Question-design skill
   This improves the questions an assistant asks. The risk is that it still
   becomes specification gathering.

2. Dialogue-phase control skill
   This separates opening, exploring, deciding, and executing. This is close to
   the goal if the main issue is timing.

3. Premature-convergence correction skill
   This specifically slows the move from vague thought to fixed answer. This
   seems like the center of the skill.

Current recommendation:
Design it as premature-convergence correction, not as a general question skill.
```

Why it works:

- It gives a hypothesis first.
- It exposes multiple frames.
- It explains the implication of each frame.
- It avoids asking the user to fill out a specification.

## Example 2: Tool Design

User:

```text
I want to make a small tool for myself, but the design is still vague.
```

Good response:

```text
Provisional judgment:
Before choosing technology, separate the tool's expected lifetime from its
failure cost.

There are three branches.

1. One-off helper
   A script is enough. Configuration, persistence, and polished errors are not
   worth much.

2. Daily personal tool
   State handling, recovery, and input tolerance matter because small failures
   will accumulate.

3. Tool for other people
   Documentation, setup flow, error messages, and compatibility become part of
   the product.

Current recommendation:
Decide whether this is disposable or something that will become part of your
daily workflow.

Catalytic question:
Is this a throwaway helper, or a tool you expect to rely on repeatedly?
```

Why it works:

- It does not ask for stack, features, or output format first.
- It reveals the decision axis that changes the design.

## Example 3: Convergence

User:

```text
Use branch-me. Output the final skill text.
```

Good response:

```text
Adopted:
Exploration stops. I will preserve the selected direction and output the final
skill text.

[Then produce the requested skill text.]
```

Why it works:

- The user signaled convergence.
- The assistant does not reopen alternatives.
- The response switches from opening mode to execution mode.

## Bad Pattern: Form-Filling

User:

```text
Could this become a reusable workflow?
```

Bad response:

```text
Who is the target user?
What output format do you want?
What constraints should I follow?
What examples should be included?
```

Why it fails:

- It assumes the user already has a complete hidden specification.
- It extracts answers before revealing useful frames.
- It may accelerate premature convergence.

Better response:

```text
Provisional judgment:
This can become a reusable workflow, but the key split is whether it should help
people discover options or help them decide among known options.

Branches:
1. Discovery workflow — expands possible interpretations.
2. Decision workflow — narrows known options into a choice.
3. Translation workflow — turns intuition into a reusable artifact.

Current recommendation:
Start with discovery if the input is still a compressed intuition.
```
