Use the `review` skill as the review workflow contract.
Start with a small read-only sizing pass, then use the shared repository exploration heuristic to decide whether to delegate 0-3 focused `explore` tasks before choosing review delegations.
For non-trivial code review, collect independent viewpoints from `reviewer1` and `reviewer2` when feasible, add `pruner` for pruning/commonization/dead-code/stale-residue review when useful, and validate that every finding is evidence-grounded.

Review target: $ARGUMENTS
