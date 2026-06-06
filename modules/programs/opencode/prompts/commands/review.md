Use the `review` skill as the review workflow contract.
Start by delegating narrow read-only discovery to `explore`, then load the `review` skill before choosing review delegations.
For non-trivial code review, collect independent viewpoints from `reviewer1` and `reviewer2` when feasible, add `pruner` for pruning/commonization/dead-code/stale-residue review when useful, and validate that every finding is evidence-grounded.

Review target: $ARGUMENTS
