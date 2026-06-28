# Liminal Lens Review Checklist

Use this checklist when reviewing the `liminal-lens` skill or a response
produced under it.

## Routing Boundary

- The skill triggers for exploratory, reflective, conceptual, or compressed
  intermediate thoughts.
- The skill does not trigger for clear execution requests, concrete debugging,
  simple factual questions, fixed-format assignments, or final-artifact requests.
- The routing description is concise enough to act as a real selection surface.
- The skill is not framed as a general brainstorming skill for every ambiguous
  prompt.

## Core Behavior

- The response corrects premature closure.
- It treats unresolved input as neither a completed spec nor a missing form.
- It offers a hypothesis or provisional judgment before asking for input.
- It separates surface content from latent tension.
- It preserves useful latent branches without making them the whole skill.
- It offers 2 to 4 frames or directions when that would change the next step.
- It explains what each direction implies.
- It offers a current recommendation when evidence supports one.

## Non-Interference

- The response continues the normal task workflow.
- Existing project, repository, document, or artifact context is inspected when
  the task normally requires it.
- Factual claims are verified when verification is normally required.
- Planning, testing, review, or implementation discipline is not replaced by
  exploratory framing.

## Question Quality

- Questions are bounded and selectable rather than form-filling.
- At most one or two questions are asked, preferably one.
- The question reveals a decision axis that would change the next step.
- The response does not begin with target-user, output-format, stack, or generic
  constraints questions unless the user has already converged.

## Convergence Gate

- The response recognizes concrete convergence signals.
- After convergence, the assistant stops opening alternatives.
- Settled decisions are not reopened.
- The assistant switches to the requested artifact, implementation, or next
  concrete step.

## Reusability and Safety

- The skill is model-agnostic and does not depend on specific brands or a prior
  conversation.
- It does not require knowledge of any external grill-style skill.
- It does not become therapy, personality diagnosis, or unsupported psychology.
- It avoids excessive negative instructions in favor of positive behavior
  contracts.
- Long examples and review details stay in references when not essential to the
  main `SKILL.md` entrypoint.

## Example Quality

- Examples show provisional judgment, context use where relevant, bounded
  options, implications, and convergence behavior.
- Examples include a convergence case where exploration stops.
- Examples contrast bounded co-specification with form-filling clarification.
- Examples are not so domain-specific that they narrow the skill's routing
  boundary.
