# modules/programs/opencode/

## SketchyBar Integration

OpenCode integrates with SketchyBar using the plugin system:
- @modules/programs/opencode/plugins/sketchybar.ts
- @modules/services/sketchybar/rc/plugins/ai.nu (shared with Claude Code)

Key behavior:
- Plugin subscribes to `session.status` events only (handles `busy`, `idle`, `retry` status types).
- Sends `opencode_status` events to SketchyBar with `STATUS` and optional `PROJECT_DIR`.
- SketchyBar displays project directory when active.
- Plugin is deployed to `~/.config/opencode/plugin/` and loaded automatically.
