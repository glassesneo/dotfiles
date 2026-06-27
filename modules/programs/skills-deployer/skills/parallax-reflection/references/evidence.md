# Evidence and classification

Use evidence in priority order.

1. User request
2. Spec
3. Acceptance criteria
4. API contract
5. Type definitions
6. Existing code
7. Tests
8. Lint, typecheck, and build results
9. Runtime output
10. Logs
11. Model inference

## Classification

- **Finding**: backed by evidence and within scope
- **Risk**: plausible, but not yet proven
- **Non-issue**: checked and refuted
- **Out-of-scope**: valid, but outside the current change

## Evidence rules

- If evidence exists, state it explicitly.
- If evidence is missing, keep the item in Risk.
- If something was checked and rejected, say why.
- Do not promote model confidence into evidence.
