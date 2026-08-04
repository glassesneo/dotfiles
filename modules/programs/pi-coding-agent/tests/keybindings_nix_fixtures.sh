#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."

flake='builtins.getFlake (toString ./.)'
base='let f = '"$flake"'; x = f.homeConfigurations."neo@seiran".extendModules { modules = [{'
tail='}]; }; in x.activationPackage.drvPath'

expect_failure() {
  local name=$1 assignment=$2 pattern=$3 output
  if output=$(nix eval --impure --raw --expr "$base $assignment $tail" 2>&1); then
    echo "$name: expected Nix evaluation failure" >&2
    exit 1
  fi
  if ! grep -Eq "$pattern" <<<"$output"; then
    echo "$name: diagnostic did not match $pattern" >&2
    echo "$output" >&2
    exit 1
  fi
}

expect_failure grammar \
  'myconfig.programs.pi-coding-agent.keybindings.overrides.commandPalette.open = ["not-a-key"];' \
  'commandPalette\.open=not-a-key'
expect_failure alias-collision \
  'myconfig.programs.pi-coding-agent.keybindings.overrides.commandPalette = { moveUp = ["esc"]; cancel = ["escape"]; };' \
  'commandPalette\.cancel.*commandPalette\.moveUp.*escape|commandPalette\.moveUp.*commandPalette\.cancel.*escape'
expect_failure unknown-action \
  'myconfig.programs.pi-coding-agent.keybindings.overrides.commandPalette.typo = ["x"];' \
  'commandPalette\.typo'
expect_failure required-empty \
  'myconfig.programs.pi-coding-agent.keybindings.overrides.commandPalette.open = [];' \
  'commandPalette\.open'
expect_failure overlapping-context \
  'myconfig.programs.pi-coding-agent.keybindings.overrides.pi."tui.editor.cursorUp" = ["ctrl+c"];' \
  'pi\.app\.clear.*pi\.tui\.editor\.cursorUp.*ctrl\+c|pi\.tui\.editor\.cursorUp.*pi\.app\.clear.*ctrl\+c'
expect_failure tmux-unrepresentable \
  'myconfig.programs.pi-coding-agent.keybindings.overrides.tmuxPreview.openFull = ["clear"];' \
  'tmuxPreview\.openFull=clear'
expect_failure direct-native-required-empty \
  'myconfig.programs.pi-coding-agent.keybindings.overrides.pi."app.exit" = [];' \
  'historyViewer\.exit'

resolved=$(nix eval --impure --raw --expr "$base myconfig.programs.pi-coding-agent.keybindings.overrides.pi.\"app.exit\" = [\"f12\"]; }]; }; in x.config.home.file.\"/Users/neo/.pi/agent/extension-keybindings.json\".text")
if [[ $(jq -r '.features.historyViewer.exit[0]' <<<"$resolved") != f12 ]]; then
  echo 'direct-native-alias: extension map did not follow pi.app.exit' >&2
  exit 1
fi

echo 'Nix keybinding failure and alias fixtures passed'
