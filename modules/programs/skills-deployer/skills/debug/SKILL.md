---
name: debug
description: Use for debug requests, /debug, bug investigation, failure triage, reproduction, logs/errors, root-cause hypotheses, and verification planning.
---

# Debug Skill

Use this skill when orchestrating bug investigation.

Workflow:
1. Define the observed failure, expected behavior, actual behavior, and impact.
2. Collect concrete logs, errors, command output, and environment details.
3. Ask `tester` for reproduction when feasible and safe.
4. Ask `explore` for relevant code paths if it has not already run.
5. Compare expected vs. actual behavior and rank root-cause hypotheses by evidence.
6. Ask `tester` for verification of the strongest hypothesis or final fix direction when feasible.
7. Report root-cause confidence, residual uncertainty, and the smallest useful next validation step.
