Filename policy (strict):

- Create a NEW timestamped file:
  `.agents/specs/YYYYMMDD-HHMMSS-<kebab-task-slug>.md` (JST)
- Fetch the timestamp with `TZ=Asia/Tokyo date +%Y%m%d-%H%M%S`.
- `<kebab-task-slug>` is required and must be non-empty.
- Use only lowercase letters, digits, and hyphens in the slug.
- Do not create missing-slug names such as `YYYYMMDD-HHMMSS-.md`.
- Never overwrite existing files.
- If collision occurs, append `-v2`, `-v3`, etc., through `-v99`.
