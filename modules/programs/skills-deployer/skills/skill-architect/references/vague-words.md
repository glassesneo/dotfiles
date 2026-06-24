# Vague Terms List

`scripts/lint_skill.py` reads this file and scans the body of `SKILL.md`. To add a new term, add one line to this file. No script change is required.

Format: one term per line. Lines starting with `#` are ignored as comments.

## Terms that leave judgment or quality undefined

appropriately
make it good
well
cleanly
properly
thoroughly
as needed
depending on the situation
where appropriate
flexibly

## Safety claims without verification criteria

safely
conservatively
carefully

## Verbs whose internal actions are not decomposed

review
research
investigate
improve
organize
optimize

## Information claims without source or timestamp

latest information
up-to-date information
current information

---

## Rewrite Direction

Do not merely delete each vague term. Replace it with one of the following forms.

| Vague wording                  | Rewrite direction                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| judge appropriately            | List the decision criteria. Example: if `SKILL.md` exceeds 500 lines, move background material to `references/`. |
| format it nicely               | Fix the output format and provide a template.                                                                    |
| ask for confirmation as needed | Separate conditions that require confirmation from conditions that do not.                                       |
| review                         | State what to detect and how to report it.                                                                       |
| research / investigate         | State the source types, comparison axes, and output granularity.                                                 |
| use the latest information     | State the retrieval procedure, such as search queries and URLs that must be checked.                             |
| perform safely                 | State forbidden operations, confirmation conditions, and rollback conditions.                                    |
| improve                        | State what may be changed and what behavior must be preserved.                                                   |

## Exception: When Explaining the Term Itself

False positives may occur when a vague term is quoted as an example of wording to avoid, such as in this skill's own `SKILL.md`. Lint WARN items are mechanical scan results. A human must inspect the context and decide whether to accept them.

