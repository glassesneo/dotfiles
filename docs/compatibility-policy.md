# Compatibility Policy

This file is the canonical compatibility policy for repository-owned
configuration, tools, and stored formats.

Repository-owned configuration, tools, and stored formats do not treat
backward compatibility as a default requirement. Compatibility readers,
deprecated aliases, dual-format windows, and automatic migrations are
exceptional and require an explicit request.

Keep these responsibilities:

- Generated artifacts and integrations must satisfy the current contract
  of an external consumer they already target.
- Do not delete user data, sessions, or artifacts unless the operator
  asked for that deletion.

This policy does not require a bulk removal of existing compatibility
code. When a repository-owned contract changes, switch owned writers and
readers to the new form only. Leave superseded state in place until an
operator archives or removes it.

Related policy: `docs/denix-architecture.md`,
`docs/documentation-policy.md`, `docs/nix-validation.md`.
