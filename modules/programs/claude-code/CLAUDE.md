# modules/programs/claude-code/

## SketchyBar Integration

Claude Code integrates with SketchyBar to show real-time status in the menu bar:
- @modules/programs/claude-code/default.nix (hooks defined in settings.hooks)
- @modules/services/sketchybar/rc/plugins/ai.nu (shared handler)

Key behavior:
- Hooks trigger on UserPromptSubmit (active) and Stop (inactive) events.
- Hooks are configured in `settings.hooks` which embeds them in `~/.claude/settings.json`.
- Handler scripts (Nix writeShellScript) send events to SketchyBar with status and project directory.
- SketchyBar plugin displays a robot icon: green when active, gray when idle/stopped.
- Popup shows current project directory when hovering over the icon.
