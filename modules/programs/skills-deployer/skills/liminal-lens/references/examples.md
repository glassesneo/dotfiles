# Liminal Lens Examples

Use these examples to calibrate decision-point handling while preserving normal
task discipline. The notes make classification explicit for reviewers; the
user-facing responses should remain natural and direct.

## Example 1: Mixed Settled and Open Points

User:

```text
Keep the existing save API and do not broaden validation. Add a brief success
message and visible errors to the settings page, but I am unsure whether status
handling should stay local or become a shared form pattern.
```

Relevant investigation:

- Inspect the settings page, save mutation, and nearby forms.
- Confirm that three forms duplicate pending, success, and error handling.
- Confirm that existing transient success messages remain visible for four
  seconds.

Decision points:

- Existing API and validation scope: settled by the user.
- Status ownership: open and high cost because choosing shared ownership changes
  several components and creates a durable interface.
- Success-message duration: open and low cost because it is a local,
  independently configurable value.

Good response:

```text
I checked the settings form, save mutation, and the two nearby forms. Their
status handling is duplicated, while the existing API already exposes the
states we need. I will keep the API and validation scope unchanged.

Assumption: I will use the existing four-second duration for the brief success
message because that local value can be changed independently later.

My provisional judgment is that the remaining decision is ownership of status
presentation:

1. Page-local — smallest patch, but leaves the same state mapping duplicated.
2. Shared status component — centralizes presentation while each form retains
   its mutation logic.
3. Shared form-state adapter — also centralizes state mapping, but creates a
   broader contract and migration.

I recommend option 2 because it removes the observed duplication without
expanding into mutation architecture. If ownership is not the right axis, please
correct it. Which direction should I implement?
```

Why it works:

- Investigation precedes options.
- Settled scope is preserved rather than reopened.
- The low-cost point gets a visible assumption and no question.
- Only the high-cost ownership decision is surfaced.

## Example 2: Low-Cost Point Only

User:

```text
The behavior is final. Update this local formatter so empty values display a
label instead of a dash.
```

Relevant investigation:

- Inspect the formatter and adjacent labels.
- Confirm that nearby UI copy uses sentence case and no trailing punctuation.

Decision points:

- Behavior and edit location: settled.
- Exact label punctuation: open and low cost because it is a one-line local
  change.

Good response:

```text
Assumption: I will use the existing sentence-case style without trailing
punctuation.

[Apply the formatter change and report the verification result.]
```

Why it works:

- The assumption is visible.
- No question is asked about a reversible detail.
- The requested work proceeds immediately.

## Example 3: High-Cost Durable Naming

User:

```text
I need a durable name for a workflow that preserves confirmed choices but asks
about decisions that would be expensive to reverse.
```

Relevant investigation:

- Review the existing workflow vocabulary and public artifact names.
- Confirm that the name will appear in package paths and user-facing commands.

Decision points:

- Naming criteria: settled by the description.
- Whether the durable name emphasizes preserved state, revision cost, or bounded
  choice: open and high cost because a later rename crosses public artifacts.

Good response:

```text
The existing names are mechanism-oriented, and this one will be exposed in both
package paths and commands. My provisional judgment is that the naming axis is
which promise should remain most visible:

1. Decision ledger — emphasizes preserving confirmed choices, but says little
   about when to ask.
2. Rework threshold — emphasizes the revision-cost test, but sounds procedural.
3. Bounded commit — emphasizes controlled choice and commitment, but is less
   explicit about preservation.

I recommend “decision ledger” if continuity is the primary user promise. If
these names expose the wrong axis, correct the framing itself. Which promise
should the durable name foreground?
```

Why it works:

- The proposal follows evidence about where the name will persist.
- The judgment is provisional and the axis itself is correctable.
- The options include implications, a recommendation, and one bounded question.

## Example 4: Fully Settled Direct Delivery

User:

```text
Use the approved specification exactly. Return the final three-line notice with
the heading “Maintenance”, the date, and the support URL. No commentary.
```

Good response:

```text
Maintenance
2026-07-17
https://support.example.test
```

Why it works:

- Every relevant decision is settled.
- The requested artifact is delivered without alternatives or process
  narration.

## Example 5: Execution Override

User:

```text
Implement the approved change now. Do not ask questions.
```

Relevant investigation:

- Inspect the approved artifact, target source, local guidance, and tests.
- Discover that the artifact leaves the order of two independent local edits
  unspecified.

Good response:

```text
Assumption: I will update the source before its independent example fixture so
the fixture can be checked against the final text.

[Implement the approved change, run the required checks, and report the result.]
```

Why it works:

- The command settles the request for execution purposes.
- The remaining assumable detail is visible and does not cause a question.
- Ordinary implementation and validation continue.

## Failure Contrast: Ideas Before Investigation

User:

```text
This settings page feels incomplete. Can you improve it?
```

Bad response:

```text
We could modernize the layout, add themes, redesign navigation, introduce
profiles, or add personalization. Which direction sounds best?
```

Why it fails:

- It brainstorms before inspecting the page or its data flow.
- It invents decision axes instead of finding the points relevant to the task.
- It asks about unevidenced scope rather than classifying actual open points by
  revision cost.

Better sequence:

1. Inspect the page, connected state, mutations, and nearby patterns.
2. Enumerate the decisions relevant to the next change.
3. Preserve user-stated and constraint-forced points.
4. State low-cost assumptions visibly and proceed on them.
5. Surface only high-cost open points with a provisional axis, bounded
   implications, a recommendation when supported, and one question.
