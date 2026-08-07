#!/usr/bin/env bash
set -euo pipefail

config_source=${CONFIGURATION_SOURCE:?CONFIGURATION_SOURCE is required}
package_root=${PACKAGE_ROOT:?PACKAGE_ROOT is required}
flake="builtins.getFlake $(jq -Rn --arg path "$config_source" '$path')"
base='let f = '"$flake"'; x = f.homeConfigurations."neo@seiran".extendModules { modules = [{'
tail='}]; }; in x.activationPackage.drvPath'

invalid='myconfig.programs.pi-coding-agent.keybindings.overrides = {
  commandPalette = { open = ["not-a-key"]; moveUp = ["esc"]; cancel = ["escape"]; typo = ["x"]; };
  question = { submit = []; "common.cancel" = ["e"]; };
  pi = { "tui.editor.cursorUp" = ["ctrl+c"]; "app.exit" = []; };
  tmuxPreview.openFull = ["clear"];
};'

if negative_output=$(nix eval --impure --raw --expr "$base $invalid $tail" 2>&1); then
  echo "combined-negative: expected Nix evaluation failure" >&2
  exit 1
fi

expect_diagnostic() {
  local name=$1 pattern=$2
  if ! grep -Eq "$pattern" <<<"$negative_output"; then
    echo "$name: diagnostic did not match $pattern" >&2
    echo "$negative_output" >&2
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

collision_line=$(grep -E 'Pi keybinding conflicts:' <<<"$negative_output" | head -n 1 || true)
grep -Eq 'commandPalette\.(cancel|moveUp)' <<<"$collision_line"
grep -Eq 'pi\.(app\.clear|tui\.editor\.cursorUp)' <<<"$collision_line"

positive_expr=$(
  cat <<NIX
let
  f = $flake;
  lib = f.inputs.nixpkgs.lib;
  base = f.homeConfigurations."neo@seiran";
  aliasOverride = base.extendModules {
    modules = [{ myconfig.programs.pi-coding-agent.keybindings.overrides.pi."app.exit" = ["f12"]; }];
  };
  navigation = base.extendModules {
    modules = [{
      myconfig.programs.tmux.prefix = "F11";
      myconfig.programs.pi-coding-agent.keybindings.overrides.subagentNavigation.parent = ["f10"];
    }];
  };
  disabled = base.extendModules {
    modules = [{ myconfig.programs.pi-coding-agent.emergency.enable = false; }];
  };
  collectEmergency = x: let
    c = x.config;
    cfg = c.myconfig.programs.pi-coding-agent;
    emergencyDir = "\${c.home.homeDirectory}/.pi/emergency-agent";
    extensionPaths = builtins.concatLists (map
      (name: c.myconfig.programs.pi-coding-agent.\${name}.extensionPaths)
      cfg.defaultExtensions);
    packageInfo = map (package: {
      name = package.pname or package.name;
      path = toString package;
      drvPath = builtins.unsafeDiscardStringContext package.drvPath;
    }) c.home.packages;
  in {
    inherit emergencyDir extensionPaths packageInfo;
    optionEnabled = cfg.emergency.enable;
    normalSettings = c.programs.pi-coding-agent.settings;
    emergencySettings =
      if builtins.hasAttr "\${emergencyDir}/settings.json" c.home.file
      then builtins.fromJSON (builtins.unsafeDiscardStringContext c.home.file."\${emergencyDir}/settings.json".text)
      else null;
    emergencyFiles = builtins.filter (name: builtins.match "\${emergencyDir}/.*" name != null) (builtins.attrNames c.home.file);
    links = builtins.listToAttrs (map (name: {
      inherit name;
      value = let source = c.home.file."\${emergencyDir}/\${name}".source; in {
        drvPath = builtins.unsafeDiscardStringContext source.drvPath;
        source = toString source;
        target = "\${cfg.configDir}/\${name}";
      };
    }) ["auth.json" "agent-profiles.json" "subagent.json" "web-search.json" "extension-keybindings.json"]);
  };
  disabledConfig = disabled.config;
  disabledDir = "\${disabledConfig.home.homeDirectory}/.pi/emergency-agent";
  disabledPackageNames = map (package: package.pname or package.name) disabledConfig.home.packages;
in {
  homeConfigurations = lib.mapAttrsToList (name: config: {
    inherit name;
    drvPath = builtins.unsafeDiscardStringContext config.activationPackage.drvPath;
  }) f.homeConfigurations;
  darwinConfigurations = lib.mapAttrsToList (name: config: {
    inherit name;
    drvPath = builtins.unsafeDiscardStringContext config.system.drvPath;
  }) f.darwinConfigurations;
  nixosRepresentative = {
    name = "nixos-seiran-vm0";
    drvPath = builtins.unsafeDiscardStringContext f.checks.aarch64-linux.nixos-seiran-vm0.drvPath;
  };
  pi = {
    extensionKeybindings = builtins.fromJSON (builtins.unsafeDiscardStringContext aliasOverride.config.home.file."/Users/neo/.pi/agent/extension-keybindings.json".text);
    navigationRuntime = builtins.fromJSON (builtins.unsafeDiscardStringContext navigation.config.home.file."/Users/neo/.pi/agent/subagent.json".text);
    navigationTmux = navigation.config.programs.tmux.extraConfig;
    darwinTmux = f.darwinConfigurations.seiran.config.home-manager.users.neo.programs.tmux.extraConfig;
  };
  emergency = {
    enabled = collectEmergency base;
    disabled = {
      optionEnabled = disabledConfig.myconfig.programs.pi-coding-agent.emergency.enable;
      emergencyPackageCount = builtins.length (builtins.filter
        (name: builtins.elem name ["pi-emergency" "pi-emergency-full"])
        disabledPackageNames);
      emergencyFiles = builtins.filter (name: builtins.match "\${disabledDir}/.*" name != null) (builtins.attrNames disabledConfig.home.file);
    };
  };
}
NIX
)
result=$(nix eval --impure --json --expr "$positive_expr")

jq -e '
  ([.homeConfigurations[].name] | sort) == (["neo@seiran", "neo@seiran-catppuccin", "neo@seiran-everforest", "neo@seiran-monochrome", "neo@seiran-vm1", "neo@seiran-vm1-catppuccin", "neo@seiran-vm1-everforest", "neo@seiran-vm1-monochrome"] | sort) and
  ([.darwinConfigurations[].name] | sort) == (["seiran", "seiran-catppuccin", "seiran-everforest", "seiran-monochrome", "seiran-vm1", "seiran-vm1-catppuccin", "seiran-vm1-everforest", "seiran-vm1-monochrome"] | sort) and
  (all(.homeConfigurations[]; .drvPath | length > 0)) and
  (all(.darwinConfigurations[]; .drvPath | length > 0)) and
  (.nixosRepresentative.drvPath | length > 0) and
  .pi.extensionKeybindings.features.historyViewer.exit[0] == "f12" and
  .pi.navigationRuntime.parentNavigationHint == "F11 F10: parent · /parent" and
  (.pi.navigationTmux | contains("bind-key f10")) and
  (.pi.navigationTmux | contains("pi-subagent-return-parent --binding #{q:client_name} #{q:session_id} #{q:window_id}")) and
  (.pi.darwinTmux | contains("pi-subagent-return-parent --binding")) and
  .emergency.enabled.optionEnabled == true and
  ([.emergency.enabled.packageInfo[].name | select(. == "pi-emergency")] | length) == 1 and
  ([.emergency.enabled.packageInfo[].name | select(. == "pi-emergency-full")] | length) == 1 and
  .emergency.enabled.emergencySettings.extensions == .emergency.enabled.extensionPaths and
  .emergency.enabled.emergencySettings.prompts == .emergency.enabled.normalSettings.prompts and
  .emergency.enabled.emergencySettings.defaultProvider == .emergency.enabled.normalSettings.defaultProvider and
  .emergency.enabled.emergencySettings.defaultModel == .emergency.enabled.normalSettings.defaultModel and
  .emergency.enabled.emergencySettings.defaultThinkingLevel == .emergency.enabled.normalSettings.defaultThinkingLevel and
  .emergency.enabled.emergencySettings.theme == "dark" and
  (.emergency.enabled.emergencyFiles | length) == 6 and
  .emergency.disabled.optionEnabled == false and
  .emergency.disabled.emergencyPackageCount == 0 and
  (.emergency.disabled.emergencyFiles | length) == 0
' <<<"$result" >/dev/null

GENERATED_EXTENSION_KEYBINDINGS=$(jq -c '.pi.extensionKeybindings' <<<"$result") \
PACKAGE_ROOT="$package_root" node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const moduleUrl = pathToFileURL(`${process.env.PACKAGE_ROOT}/extensions_src/utilities/extension_keybindings.ts`);
    const { validateExtensionKeybindings } = await import(moduleUrl.href);
    validateExtensionKeybindings(JSON.parse(process.env.GENERATED_EXTENSION_KEYBINDINGS), "generated extension-keybindings.json");
  '

gc_roots=$(mktemp -d "${TMPDIR:-/tmp}/configuration-contracts.XXXXXX")
trap 'rm -rf "$gc_roots"' EXIT
link_index=0
while IFS=$'\t' read -r drv_path source target; do
  nix-store --realise "$drv_path" --add-root "$gc_roots/link-$link_index" >/dev/null
  [[ $(readlink "$source") == "$target" ]]
  ((link_index += 1))
done < <(jq -r '.emergency.enabled.links[] | [.drvPath, .source, .target] | @tsv' <<<"$result")

package_field() {
  jq -r --arg name "$1" --arg field "$2" '.emergency.enabled.packageInfo[] | select(.name == $name) | .[$field]' <<<"$result"
}
for package_name in pi-emergency pi-emergency-full; do
  nix-store --realise "$(package_field "$package_name" drvPath)" --add-root "$gc_roots/$package_name" >/dev/null
done
safe_script=$(<"$(package_field pi-emergency path)/bin/pi-emergency")
full_script=$(<"$(package_field pi-emergency-full path)/bin/pi-emergency-full")
for script in "$safe_script" "$full_script"; do
  [[ $script == *'PI_CODING_AGENT_DIR='*'/.pi/emergency-agent'* ]]
  [[ $script == *'PI_CODING_AGENT_SESSION_DIR='*'/.pi/agent/sessions'* ]]
  [[ $script == *'/bin/pi'* ]]
done
safe_argv=${safe_script#*'/bin/pi '}
full_argv=${full_script#*'/bin/pi '}
expected_safe_argv=$'\\\n  --no-extensions \\\n  --no-skills \\\n  --no-prompt-templates \\\n  --no-themes \\\n  --no-approve \\\n  "$@"'
[[ $safe_argv == "$expected_safe_argv" ]]
[[ $full_argv == '--no-approve "$@"' ]]

mkdir -p "$out"
jq '{homeConfigurations, darwinConfigurations, nixosRepresentative}' <<<"$result" >"$out/inventory.json"
printf 'Configuration contracts passed (one negative and one positive nix eval)\n'
