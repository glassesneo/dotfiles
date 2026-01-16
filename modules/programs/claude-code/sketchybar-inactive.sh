set -euo pipefail
# Read JSON input from stdin (required by Claude Code hook protocol)
INPUT=$(cat)
# Trigger SketchyBar event to show Claude as inactive
@sketchybar@ --trigger claude_status STATUS=inactive 2>/dev/null || true
# Return empty JSON response (required by hook protocol)
echo '{}'
