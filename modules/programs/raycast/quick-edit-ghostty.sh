# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Quick Edit with Vim (Ghostty)
# @raycast.mode silent
# @raycast.icon 👻
# @raycast.packageName Developer Utils

set -euo pipefail

# Initialize variables for trap safety
tmp_file=""
trap 'rm -f "${tmp_file}"' EXIT

export SKIP_ZELLIJ=1

# Set UTF-8 locale to fix encoding and perl warnings
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
export LC_CTYPE=en_US.UTF-8

# Use mktemp for unique file names (prevents collisions)
tmp_file="$(mktemp "${TMPDIR:-/tmp}/raycast-note.XXXXXX.md")"
initial_hash="$(shasum -a 256 "$tmp_file" | awk '{print $1}')"

# Capture frontmost app BEFORE Raycast takes focus
# Use bundle ID for reliable activation later
front_app_id="$(osascript -e 'tell application "System Events" to get bundle identifier of first application process whose frontmost is true' 2>/dev/null || echo "")"

# Launch Ghostty with vim in a new window
# Note: Ghostty doesn't yet support opening quick terminal from CLI
# Using -e flag to execute command directly
/Applications/Ghostty.app/Contents/MacOS/ghostty -e zsh -i -c "
  export SKIP_ZELLIJ=1
  vim -c 'set encoding=utf-8' -c 'set fileencoding=utf-8' '$tmp_file'
  final_hash=\"\$(shasum -a 256 '$tmp_file' | awk '{print \$1}')\"
  if [ \"\$final_hash\" != '$initial_hash' ] && [ -s '$tmp_file' ]; then
    cat '$tmp_file' | pbcopy
    osascript -e 'tell application id \"$front_app_id\" to activate' 2>/dev/null
    sleep 0.2
    osascript -e 'tell application \"System Events\" to keystroke \"v\" using command down' 2>/dev/null || {
      osascript -e 'display notification \"Content copied to clipboard. Paste manually.\" with title \"Quick Edit\"' 2>/dev/null || true
    }
  fi
" || true
