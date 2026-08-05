#!/usr/bin/env bash
set -euo pipefail
repo_root=${PI_FLAKE_ROOT:-"$(cd "$(dirname "$0")/../../../.." && pwd)"}
cd "$repo_root"

flake="builtins.getFlake $(jq -Rn --arg path "$repo_root" '$path')"
base='let f = '"$flake"'; x = f.homeConfigurations."neo@seiran".extendModules { modules = [{'
tail='}]; }; in x.activationPackage.drvPath'

invalid='myconfig.programs.pi-coding-agent.keybindings.overrides = {
  commandPalette = { open = ["not-a-key"]; moveUp = ["esc"]; cancel = ["escape"]; typo = ["x"]; };
  question = { submit = []; "common.cancel" = ["e"]; };
  pi = { "tui.editor.cursorUp" = ["ctrl+c"]; "app.exit" = []; };
  tmuxPreview.openFull = ["clear"];
};'

if output=$(nix eval --impure --raw --expr "$base $invalid $tail" 2>&1); then
  echo "combined-negative: expected Nix evaluation failure" >&2
  exit 1
fi

expect_diagnostic() {
  local name=$1 pattern=$2
  if ! grep -Eq "$pattern" <<<"$output"; then
    echo "$name: diagnostic did not match $pattern" >&2
    echo "$output" >&2
    exit 1
  fi
  printf 'negative: %s\n' "$name"
}
expect_diagnostic grammar 'commandPalette\.open=not-a-key'
expect_diagnostic alias-collision 'commandPalette\.cancel.*commandPalette\.moveUp.*escape|commandPalette\.moveUp.*commandPalette\.cancel.*escape'
expect_diagnostic unknown-action 'commandPalette\.typo'
expect_diagnostic required-empty 'question\.submit'
expect_diagnostic question-choice-collision 'question\.common\.cancel.*question\.choice\.select-and-note.*e|question\.choice\.select-and-note.*question\.common\.cancel.*e'
expect_diagnostic overlapping-context 'pi\.app\.clear.*pi\.tui\.editor\.cursorUp.*ctrl\+c|pi\.tui\.editor\.cursorUp.*pi\.app\.clear.*ctrl\+c'
expect_diagnostic tmux-unrepresentable 'tmuxPreview\.openFull=clear'
expect_diagnostic direct-native-required-empty 'historyViewer\.exit'

# Both collision classes must be reported by the single invalid evaluation.
collision_line=$(grep -E 'Pi keybinding conflicts:' <<<"$output" | head -n 1 || true)
grep -Eq 'commandPalette\.(cancel|moveUp)' <<<"$collision_line"
grep -Eq 'pi\.(app\.clear|tui\.editor\.cursorUp)' <<<"$collision_line"

resolved=$(nix eval --impure --raw --expr "$base myconfig.programs.pi-coding-agent.keybindings.overrides.pi.\"app.exit\" = [\"f12\"]; }]; }; in x.config.home.file.\"/Users/neo/.pi/agent/extension-keybindings.json\".text")
if [[ $(jq -r '.features.historyViewer.exit[0]' <<<"$resolved") != f12 ]]; then
  echo 'direct-native-alias: extension map did not follow pi.app.exit' >&2
  exit 1
fi
printf 'alias propagation: passed\n'
printf 'Nix keybinding failure and alias fixtures passed (2 nix eval invocations)\n'
