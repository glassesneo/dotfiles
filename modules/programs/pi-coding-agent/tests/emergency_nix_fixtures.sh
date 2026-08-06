#!/usr/bin/env bash
set -euo pipefail
package_root=$(cd "$(dirname "$0")/.." && pwd)
repo_root=${PI_FLAKE_ROOT:-"$(cd "$package_root/../../.." && pwd)"}
cd "$repo_root"

gc_roots=$(mktemp -d "${TMPDIR:-/tmp}/pi-emergency-fixture.XXXXXX")
trap 'rm -rf "$gc_roots"' EXIT

flake="builtins.getFlake $(jq -Rn --arg path "$repo_root" '$path')"
result=$(nix eval --impure --json --expr '
  let
    f = '"$flake"';
    enabled = f.homeConfigurations."neo@seiran";
    disabled = enabled.extendModules {
      modules = [{ myconfig.programs.pi-coding-agent.emergency.enable = false; }];
    };
    collect = x: let
      c = x.config;
      cfg = c.myconfig.programs.pi-coding-agent;
      emergencyDir = "${c.home.homeDirectory}/.pi/emergency-agent";
      extensionPaths = builtins.concatLists (map
        (name: c.myconfig.programs.pi-coding-agent.${name}.extensionPaths)
        cfg.defaultExtensions);
      packageInfo = map (package: {
        name = package.pname or package.name;
        path = toString package;
        drvPath = package.drvPath;
      }) c.home.packages;
      emergencyNames = ["pi-emergency" "pi-emergency-full"];
    in {
      inherit emergencyDir extensionPaths packageInfo;
      optionEnabled = cfg.emergency.enable;
      normalSettings = c.programs.pi-coding-agent.settings;
      emergencySettings =
        if builtins.hasAttr "${emergencyDir}/settings.json" c.home.file
        then builtins.fromJSON (builtins.unsafeDiscardStringContext c.home.file."${emergencyDir}/settings.json".text)
        else null;
      emergencyFiles = builtins.filter (name: builtins.match "${emergencyDir}/.*" name != null) (builtins.attrNames c.home.file);
      links = builtins.listToAttrs (map (name: {
        inherit name;
        value = let source = c.home.file."${emergencyDir}/${name}".source; in {
          inherit (source) drvPath;
          source = toString source;
          target = "${cfg.configDir}/${name}";
        };
      }) ["auth.json" "agent-profiles.json" "subagent.json" "web-search.json" "extension-keybindings.json"]);
      emergencyPackageCount = builtins.length (builtins.filter (package: builtins.elem package.name emergencyNames) packageInfo);
    };
  in {
    enabled = collect enabled;
    disabled = let
      c = disabled.config;
      emergencyDir = "${c.home.homeDirectory}/.pi/emergency-agent";
      names = map (package: package.pname or package.name) c.home.packages;
    in {
      optionEnabled = c.myconfig.programs.pi-coding-agent.emergency.enable;
      emergencyPackageCount = builtins.length (builtins.filter (name: builtins.elem name ["pi-emergency" "pi-emergency-full"]) names);
      emergencyFiles = builtins.filter (name: builtins.match "${emergencyDir}/.*" name != null) (builtins.attrNames c.home.file);
    };
  }
')

jq -e '
  .enabled.optionEnabled == true and
  .enabled.emergencyPackageCount == 2 and
  ([.enabled.packageInfo[].name | select(. == "pi-emergency")] | length) == 1 and
  ([.enabled.packageInfo[].name | select(. == "pi-emergency-full")] | length) == 1 and
  .enabled.emergencySettings.extensions == .enabled.extensionPaths and
  .enabled.emergencySettings.prompts == .enabled.normalSettings.prompts and
  .enabled.emergencySettings.defaultProvider == .enabled.normalSettings.defaultProvider and
  .enabled.emergencySettings.defaultModel == .enabled.normalSettings.defaultModel and
  .enabled.emergencySettings.defaultThinkingLevel == .enabled.normalSettings.defaultThinkingLevel and
  .enabled.emergencySettings.theme == "dark" and
  (.enabled.emergencyFiles | length) == 6 and
  .disabled.optionEnabled == false and
  .disabled.emergencyPackageCount == 0 and
  (.disabled.emergencyFiles | length) == 0
' <<<"$result" >/dev/null

link_index=0
while IFS=$'\t' read -r drv_path source target; do
  nix-store --realise "$drv_path" --add-root "$gc_roots/link-$link_index" >/dev/null
  if [[ $(readlink "$source") != "$target" ]]; then
    echo "emergency link $source did not target $target" >&2
    exit 1
  fi
  ((link_index += 1))
done < <(jq -r '.enabled.links[] | [.drvPath, .source, .target] | @tsv' <<<"$result")

package_field() {
  jq -r --arg name "$1" --arg field "$2" '.enabled.packageInfo[] | select(.name == $name) | .[$field]' <<<"$result"
}

safe_path=$(package_field pi-emergency path)
full_path=$(package_field pi-emergency-full path)
safe_drv=$(package_field pi-emergency drvPath)
full_drv=$(package_field pi-emergency-full drvPath)
nix-store --realise "$safe_drv" --add-root "$gc_roots/pi-emergency" >/dev/null
nix-store --realise "$full_drv" --add-root "$gc_roots/pi-emergency-full" >/dev/null
safe_script=$(<"$safe_path/bin/pi-emergency")
full_script=$(<"$full_path/bin/pi-emergency-full")

for script in "$safe_script" "$full_script"; do
  [[ $script == *'PI_CODING_AGENT_DIR='*'/.pi/emergency-agent'* ]]
  [[ $script == *'PI_CODING_AGENT_SESSION_DIR='*'/.pi/agent/sessions'* ]]
  [[ $script == *'/bin/pi'* ]]
done
safe_argv=${safe_script#*'/bin/pi '}
full_argv=${full_script#*'/bin/pi '}
expected_safe_argv=$'\\\n  --no-extensions \\\n  --no-skills \\\n  --no-prompt-templates \\\n  --no-themes \\\n  --no-approve \\\n  "$@"'
expected_full_argv='--no-approve "$@"'
[[ $safe_argv == "$expected_safe_argv" ]]
[[ $full_argv == "$expected_full_argv" ]]

printf 'Pi emergency Nix fixtures passed (enabled projection, wrappers, shared links, disabled projection)\n'
