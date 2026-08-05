#!/usr/bin/env bash
set -euo pipefail
package_root=$(cd "$(dirname "$0")/.." && pwd)
repo_root=${PI_FLAKE_ROOT:-"$(cd "$package_root/../../.." && pwd)"}
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
PACKAGE_ROOT="$package_root" GENERATED_EXTENSION_KEYBINDINGS="$resolved" node --input-type=module -e '
  import { pathToFileURL } from "node:url";
  const moduleUrl = pathToFileURL(`${process.env.PACKAGE_ROOT}/extensions_src/utilities/extension_keybindings.ts`);
  const { validateExtensionKeybindings } = await import(moduleUrl.href);
  validateExtensionKeybindings(JSON.parse(process.env.GENERATED_EXTENSION_KEYBINDINGS), "generated extension-keybindings.json");
'
printf 'generated extension schema: passed\n'
printf 'alias propagation: passed\n'

navigation_module='myconfig.programs.tmux.prefix = "F11";
  myconfig.programs.pi-coding-agent.keybindings.overrides.subagentNavigation.parent = ["f10"];'
navigation_runtime=$(nix eval --impure --raw --expr "$base $navigation_module }]; }; in x.config.home.file.\"/Users/neo/.pi/agent/subagent.json\".text")
if [[ $(jq -r '.parentNavigationHint' <<<"$navigation_runtime") != 'F11 F10: parent · /parent' ]]; then
  echo 'subagent navigation: runtime hint did not follow prefix/key override' >&2
  exit 1
fi
navigation_tmux=$(nix eval --impure --raw --expr "$base $navigation_module }]; }; in x.config.programs.tmux.extraConfig")
if [[ $navigation_tmux != *'bind-key f10'* || $navigation_tmux != *'pi-subagent-return-parent --binding #{q:client_name} #{q:session_id} #{q:window_id}'* ]]; then
  echo 'subagent navigation: tmux binding did not follow key override' >&2
  exit 1
fi
printf 'subagent navigation propagation: passed\n'

darwin_tmux=$(nix eval --impure --raw --expr "let f = $flake; in f.darwinConfigurations.seiran.config.home-manager.users.neo.programs.tmux.extraConfig")
if [[ $darwin_tmux != *'pi-subagent-return-parent --binding'* ]]; then
  echo 'nix-darwin placement: Home Manager tmux config omitted the subagent binding' >&2
  exit 1
fi
printf 'nix-darwin contribution placement: passed\n'
printf 'Nix keybinding failure and propagation fixtures passed (5 nix eval invocations)\n'
