set -euo pipefail
# Read JSON input from stdin (required by Claude Code hook protocol)
INPUT=$(cat)
# Extract current working directory from JSON input
PROJECT_DIR=$(echo "$INPUT" | @jq@ -r '.cwd // ""')
# Trigger SketchyBar event to show Claude as active with project directory
@sketchybar@ --trigger claude_status STATUS=active PROJECT_DIR="$PROJECT_DIR" 2>/dev/null || true
# Return empty JSON response (required by hook protocol)
echo '{}'
