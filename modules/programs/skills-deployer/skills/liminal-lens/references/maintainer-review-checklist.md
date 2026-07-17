# Liminal Lens Maintainer Review Checklist

Use this checklist when revising or auditing the `liminal-lens` skill package.
It is for package maintainers, not runtime response generation.

## Routing and Package Alignment

- The package directory is `liminal-lens`, the entrypoint is exactly `SKILL.md`,
  and frontmatter declares `name: liminal-lens`.
- The frontmatter description routes underspecified requirements, unresolved
  design directions, durable concept naming, vague option comparison,
  workflow/prompt/skill design, and dissatisfaction without a settled desired
  change.
- The description explains normal investigation, settled-decision preservation,
  visible reversible assumptions, and costly bounded choices.
- Adjacent exclusions are limited to simple factual questions, fixed-format
  assignments, debugging with an obvious next step, and direct or final-artifact
  requests whose relevant decisions are settled.
- Concrete implementation details alone do not exclude an otherwise applicable
  mixed request.

## Required Behavior Placement

- `SKILL.md` contains the complete decision-point procedure, settlement rules,
  execution override, Assumption Cost Test, non-interference contract, and
  high-cost bounded-choice behavior.
- References calibrate or audit the behavior; they do not hide requirements
  needed for basic execution.
- The revision-cost and reversibility test is the sole branch criterion for open
  points.
- Architecture, ownership, contract, naming, scope, formatting, defaults, and
  similar categories appear only as illustrations of likely revision cost, not
  as independent question gates.
- Per-point settlement is not replaced by a conversation-wide status or gate.
- Fully settled input reduces to ordinary execution without process narration.

## Reference Separation

- `references/review-checklist.md` contains runtime-agent self-checks only.
- This file owns maintainer-only package and routing checks.
- `SKILL.md` references the runtime checklist and examples, but does not link to
  this maintainer-only checklist.
- Reference paths resolve within the package.

## Language and Contradiction Review

- The skill body and references are English and independent of model brands or
  families.
- No legacy text classifies the whole conversation by a dialogue status,
  reopens settled decisions, uses topic categories to decide whether to ask, or
  broadly excludes requests containing implementation detail.
- No text instructs the agent to announce that it is stopping, switching, or
  entering a dialogue posture before delivering work.
- Anti-patterns cover reopened settled points, low-cost questions, silent
  high-cost assumptions, detached brainstorming, and workflow interference.

## Example Quality

- Examples begin with relevant investigation when the task requires it.
- A mixed case preserves settled scope while surfacing only a high-cost open
  point.
- A low-cost-only case states a visible assumption, asks no question, and
  proceeds.
- A high-cost case includes a provisional axis, two to four directions with
  implications, a supported recommendation, permission to correct the axis, and
  no more than one or two bounded questions.
- Fully settled and execution-override cases deliver task work directly.
- Failure contrast demonstrates why investigation must precede options.
- Incidental example domains do not become routing or cost-test rules.

## Validation

- New package files are staged before flake evaluation so the flake can see
  them.
- Markdown and diff hygiene checks pass.
- Package registration and target runtimes remain unchanged.
- Manual review traces every governing acceptance criterion and required
  tabletop scenario without claiming automated semantic coverage.
