# Accessibility / UX Common Failures

Read during review or final verification to sanity-check the flow.

- ARIA added to repair avoidable non-semantic HTML.
- `outline: none` removes focus visibility.
- Click works but Enter or Space does not.
- Icon button has no accessible name.
- Placeholder is the only label.
- Error is shown only by color or is not connected to the field.
- Important result appears only in a transient toast.
- Modal opens without moving focus or closes without restoring focus.
- Fixed or sticky UI hides focused controls.
- Custom select, tab, menu, or combobox lacks expected keyboard behavior.
- Responsive layout changes reading or focus order incorrectly.
- Infinite scroll or dynamic updates lose position or announce too much.
- Automated checks pass and the work is incorrectly treated as fully accessible.
