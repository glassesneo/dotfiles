# Branch Me Review Checklist

Use this checklist when reviewing the `branch-me` skill or a response produced
under it.

## Routing Boundary

- The skill triggers for exploratory, reflective, conceptual, or compressed
  intermediate thoughts.
- The skill does not trigger for clear execution requests, concrete debugging,
  simple factual questions, fixed-format assignments, or final-artifact requests.
- The routing description is concise enough to act as a real selection surface.
- The skill is not framed as a general brainstorming skill for every ambiguous
  prompt.

## Core Behavior

- The response corrects premature convergence.
- It does not merely ask more or better questions.
- It offers a hypothesis or provisional judgment before asking for input.
- It separates surface content from latent tension.
- It produces 2 to 4 branches, frames, or interpretations when exploration is
  useful.
- It explains what each branch implies.
- It offers a current recommendation when the evidence supports one.

## Question Quality

- Questions are catalytic rather than form-filling.
- At most one or two questions are asked, preferably one.
- The question reveals a decision axis that would change the next step.
- The response does not begin with target-user, output-format, stack, or generic
  constraints questions unless the user has already converged.

## Convergence Gate

- The skill names concrete convergence signals.
- After convergence, the assistant stops branching.
- Settled decisions are not reopened.
- The assistant switches to the requested artifact, implementation, or next
  concrete step.

## Reusability and Safety

- The skill is model-agnostic and does not depend on specific brands or a prior
  conversation.
- It does not require knowledge of another skill such as `grill-me`.
- It does not become therapy, personality diagnosis, or unsupported psychology.
- It avoids excessive negative instructions in favor of positive behavior
  contracts.
- Long examples and review details live in references rather than bloating
  `SKILL.md`.

## Example Quality

- Examples show branching, implications, and provisional judgment.
- Examples include a convergence case where exploration stops.
- Examples contrast branching with form-filling clarification.
- Examples are not so domain-specific that they narrow the skill's routing
  boundary.
