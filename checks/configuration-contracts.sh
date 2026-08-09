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

expect_orchestration_rejection() {
  local name=$1 assignment=$2
  if output=$(nix eval --impure --raw --expr "$base $assignment $tail" 2>&1); then
    echo "$name: expected Nix evaluation failure" >&2
    exit 1
  fi
  if ! grep -Eq 'settled eight-agent|role sets.*mesh budgets|multiple definitions' <<<"$output"; then
    echo "$name: missing exact-capability diagnostic" >&2
    echo "$output" >&2
    exit 1
  fi
  printf 'negative: %s\n' "$name"
}
expect_orchestration_rejection critic-mutation 'myconfig.programs.pi-coding-agent.orchestration.agents.critic.tools = f.inputs.nixpkgs.lib.mkForce ["read" "write"];'
expect_orchestration_rejection generic-child-extension 'myconfig.programs.pi-coding-agent.orchestration.agents.reviewer.childExtensionContributions = f.inputs.nixpkgs.lib.mkForce ["/unexpected.ts"];'
expect_orchestration_rejection role-set-mutation 'myconfig.programs.pi-coding-agent.orchestration.roleSets."mode:recon" = f.inputs.nixpkgs.lib.mkForce ["explorer" "reviewer" "codex"];'
expect_orchestration_rejection budget-mutation 'myconfig.programs.pi-coding-agent.orchestration.budgets.maxLiveAgents = f.inputs.nixpkgs.lib.mkForce 13;'

collision_line=$(grep -E 'Pi keybinding conflicts:' <<<"$negative_output" | head -n 1 || true)
grep -Eq 'commandPalette\.(cancel|moveUp)' <<<"$collision_line"
grep -Eq 'pi\.(app\.clear|tui\.editor\.cursorUp)' <<<"$collision_line"

positive_expr=$(
  cat <<NIX
let
  f = $flake;
  base = f.homeConfigurations."neo@seiran";
  aliasOverride = base.extendModules {
    modules = [{ myconfig.programs.pi-coding-agent.keybindings.overrides.pi."app.exit" = ["f12"]; }];
  };
  aliasHomeDir = aliasOverride.config.home.homeDirectory;
  navigation = base.extendModules {
    modules = [{
      myconfig.programs.tmux.prefix = "F11";
      myconfig.programs.pi-coding-agent.keybindings.overrides.meshNavigation.parent = ["f10"];
    }];
  };
  navigationHomeDir = navigation.config.home.homeDirectory;
  disabled = base.extendModules {
    modules = [{ myconfig.programs.pi-coding-agent.emergency.enable = false; }];
  };
  questionDisabled = base.extendModules {
    modules = [{ myconfig.programs.pi-coding-agent.question.enable = false; }];
  };
  darwin = f.darwinConfigurations.seiran;
  partialHomeSecrets = base.extendModules {
    modules = [{ myconfig.toplevel.secrets.names = f.inputs.nixpkgs.lib.mkForce ["parallel-api-key" "exa-api-key"]; }];
  };
  partialSecrets = darwin.extendModules {
    modules = [{ myconfig.toplevel.secrets.names = f.inputs.nixpkgs.lib.mkForce ["parallel-api-key" "exa-api-key"]; }];
  };
  nullSecrets = darwin.extendModules {
    modules = [{ myconfig.toplevel.secrets.enable = f.inputs.nixpkgs.lib.mkForce false; }];
  };
  retrievalSecretNames = ["parallel-api-key" "brave-api-key" "brave-free-api-key" "exa-api-key"];
  collectWebRetrieval = system: let
    c = system.config.home-manager.users.neo;
    configDir = "\${c.home.homeDirectory}/.pi/agent";
  in {
    config = builtins.fromJSON (builtins.unsafeDiscardStringContext c.home.file."\${configDir}/web-retrieval.json".text);
    secretPaths = builtins.listToAttrs (map (name: {
      inherit name;
      value = system.config.sops.secrets.\${name}.path or null;
    }) retrievalSecretNames);
  };
  collectHomeWebRetrieval = home: let
    c = home.config;
    configDir = "\${c.home.homeDirectory}/.pi/agent";
  in {
    config = builtins.fromJSON (builtins.unsafeDiscardStringContext c.home.file."\${configDir}/web-retrieval.json".text);
    secretPaths = builtins.listToAttrs (map (name: {
      inherit name;
      value =
        if c.myconfig.toplevel.secrets.enable && builtins.elem name c.myconfig.toplevel.secrets.names
        then "/run/secrets/\${name}"
        else null;
    }) retrievalSecretNames);
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
    }) ["auth.json" "models.json" "agent-modes.json" "agent-catalog.json" "orchestration.json" "web-retrieval.json" "extension-keybindings.json"]);
  };
  disabledConfig = disabled.config;
  disabledDir = "\${disabledConfig.home.homeDirectory}/.pi/emergency-agent";
  disabledPackageNames = map (package: package.pname or package.name) disabledConfig.home.packages;
in {
  pi = {
    defaultExtensionNames = base.config.myconfig.programs.pi-coding-agent.defaultExtensions;
    defaultExtensionPaths = base.config.programs.pi-coding-agent.settings.extensions;
    modes = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."\${base.config.home.homeDirectory}/.pi/agent/agent-modes.json".text);
    questionDisabled = {
      extensionPaths = questionDisabled.config.programs.pi-coding-agent.settings.extensions;
      modes = builtins.fromJSON (builtins.unsafeDiscardStringContext questionDisabled.config.home.file."\${questionDisabled.config.home.homeDirectory}/.pi/agent/agent-modes.json".text);
    };
    catalog = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."\${base.config.home.homeDirectory}/.pi/agent/agent-catalog.json".text);
    models = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."\${base.config.home.homeDirectory}/.pi/agent/models.json".text);
    orchestration = builtins.fromJSON (builtins.unsafeDiscardStringContext base.config.home.file."\${base.config.home.homeDirectory}/.pi/agent/orchestration.json".text);
    webRetrieval = {
      home = collectHomeWebRetrieval base;
      homePartial = collectHomeWebRetrieval partialHomeSecrets;
      all = collectWebRetrieval darwin;
      partial = collectWebRetrieval partialSecrets;
      null = collectWebRetrieval nullSecrets;
    };
    extensionKeybindings = builtins.fromJSON (builtins.unsafeDiscardStringContext aliasOverride.config.home.file."\${aliasHomeDir}/.pi/agent/extension-keybindings.json".text);
    navigationRuntime = builtins.fromJSON (builtins.unsafeDiscardStringContext navigation.config.home.file."\${navigationHomeDir}/.pi/agent/orchestration.json".text);
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
  .pi.defaultExtensionNames == ["popup", "mode", "orchestration", "command_palette", "web_retrieval"] and
  ([.pi.defaultExtensionPaths[] | split("/")[-1]] == ["popup.ts", "mode.ts", "orchestration.ts", "command_palette.ts", "web_search.ts", "web_fetch.ts", "question.ts", "interaction_policy.ts", "agent_artifact.ts"]) and
  ((.pi.modes | keys) == ["defaultMode", "modes", "schemaVersion"]) and .pi.modes.schemaVersion == 1 and .pi.modes.defaultMode == "recon" and
  ((.pi.modes.modes | keys) == ["ops", "recon"]) and .pi.modes.modes.recon.allowAllTools == false and .pi.modes.modes.ops.allowAllTools == true and
  (.pi.modes.modes.recon.tools | index("question")) != null and
  (["web_search","web_fetch"] - .pi.modes.modes.recon.tools | length) == 0 and
  (["mesh_run","mesh_submit","mesh_get","mesh_wait","mesh_stop","mesh_route"] - .pi.modes.modes.recon.tools | length) == 0 and
   (.pi.modes.modes.recon.tools | index("mesh_enable")) == null and
  ([.pi.modes.modes[].tools[]? | select(startswith("subagent_"))] | length) == 0 and
  ([.pi.questionDisabled.extensionPaths[] | split("/")[-1]] | index("question.ts")) == null and
  (.pi.questionDisabled.modes.modes.recon.tools | index("question")) == null and
  ((.pi.catalog | keys) == ["agents", "schemaVersion"]) and .pi.catalog.schemaVersion == 1 and
  ((.pi.catalog.agents | keys) == ["codex", "critic", "explorer", "fast-worker", "researcher", "reviewer", "validator", "worker"]) and
  (.pi.catalog.agents.reviewer.childExtensionContributions | length) == 1 and (.pi.catalog.agents.reviewer.childExtensionContributions[0] | endswith("/agent_artifact.ts")) and
  .pi.catalog.agents.researcher.model == "openai-codex/gpt-5.6-terra" and .pi.catalog.agents.researcher.thinkingLevel == "high" and
  .pi.catalog.agents.researcher.tools == ["read","grep","find","ls","bash","web_search","web_fetch"] and .pi.catalog.agents.researcher.skillOptIns == ["web-research"] and
  ([.pi.catalog.agents.researcher.childExtensionContributions[] | split("/")[-1]] == ["web_search.ts","web_fetch.ts"]) and
  ([.pi.catalog.agents | to_entries[] | select(.key != "researcher") | .value.tools[]? | select(. == "web_search" or . == "web_fetch")] | length) == 0 and
  ([.pi.catalog.agents.explorer, .pi.catalog.agents.worker, .pi.catalog.agents.validator, .pi.catalog.agents.critic, .pi.catalog.agents["fast-worker"], .pi.catalog.agents.codex] | all(.childExtensionContributions == [])) and
  .pi.catalog.agents.critic.tools == ["read","grep","find","ls","bash"] and .pi.catalog.agents.critic.skillOptIns == [] and
  .pi.catalog.agents.reviewer.tools == ["read","grep","find","ls","bash","mesh_enable","mesh_run","mesh_submit","mesh_get","mesh_wait","mesh_stop","mesh_route","save_agent_artifact"] and
  ([.pi.catalog.agents[].tools[]? | select(startswith("subagent_"))] | length) == 0 and
  .pi.catalog.agents["fast-worker"].harness == "cursor-agent" and .pi.catalog.agents["fast-worker"].tools == [] and
  .pi.catalog.agents.codex.harness == "codex" and .pi.catalog.agents.codex.tools == [] and .pi.catalog.agents.codex.skillOptIns == [] and
  .pi.catalog.agents.codex.harnessOptions == {"mode":"read-only","permissionPolicy":"reject","webSearch":"cached"} and
  .pi.models == {"providers":{"openai-codex":{"modelOverrides":{"gpt-5.6-sol":{"contextWindow":1050000}}}}} and
  ((.pi.orchestration | keys) == ["budgets", "childBridgeExtension", "gc", "harnesses", "historyViewerExtension", "natureHandleWords", "orchestrationExtension", "parentNavigationHint", "popupExtension", "returnParentCommand", "roleSets", "schemaVersion", "stateRoot", "tmux"]) and
  .pi.orchestration.schemaVersion == 2 and
  .pi.orchestration.roleSets == {"mode:recon":["explorer","reviewer","critic","researcher","codex"],"mode:ops":["explorer","worker","validator","reviewer","critic","researcher","fast-worker","codex"]} and
  .pi.orchestration.budgets == {"maxLiveAgents":20,"maxConcurrentTasks":6,"maxTasksPerMesh":256} and
  .pi.orchestration.gc == {"contextHeadroomTokens":32768,"periodicIntervalMs":5000,"activityHeartbeatMs":2000,"activityStaleMs":10000,"roles":{"explorer":{"collectAt":6,"retain":4,"pressureFloor":1},"worker":{"collectAt":6,"retain":3,"pressureFloor":1},"validator":{"collectAt":3,"retain":2,"pressureFloor":1},"reviewer":{"collectAt":3,"retain":1,"pressureFloor":1},"critic":{"collectAt":6,"retain":4,"pressureFloor":1},"researcher":{"collectAt":3,"retain":1,"pressureFloor":1},"fast-worker":{"collectAt":2,"retain":1,"pressureFloor":0},"codex":{"collectAt":3,"retain":2,"pressureFloor":0}}} and
  (.pi.orchestration | has("maxDepth") | not) and (.pi.orchestration | has("delegation") | not) and
  (.pi.orchestration.stateRoot | endswith("/pi/orchestration-v2")) and (.pi.orchestration.stateRoot | contains("orchestration-v1") | not) and
  .pi.orchestration.harnesses.codex.adapter == "codex-acp" and (.pi.orchestration.harnesses.codex.command | endswith("/bin/codex-acp")) and
  (.pi.orchestration.harnesses.codex.workerEntrypoint | endswith("/orchestration_external_worker.ts")) and
  .pi.extensionKeybindings.features.historyViewer.exit[0] == "f12" and
  (.pi.extensionKeybindings.features | has("meshPalette")) and
  .pi.extensionKeybindings.features.meshNavigation.parent[0] == "u" and
  (.pi.extensionKeybindings.features | has("subagentPalette") | not) and
  (.pi.extensionKeybindings.features | has("subagentNavigation") | not) and
  .pi.navigationRuntime.parentNavigationHint == "F11 F10: parent · /parent" and
  (.pi.navigationTmux | contains("bind-key f10")) and
  (.pi.navigationTmux | contains("pi-mesh-return-parent --binding #{q:client_name} #{q:session_id} #{q:window_id}")) and
  (.pi.navigationTmux | contains("#{==:#{@pi_mesh_schema},1}")) and
  (.pi.navigationTmux | contains("pi-subagent-return-parent") | not) and
  (.pi.darwinTmux | contains("pi-mesh-return-parent --binding")) and
  .emergency.enabled.optionEnabled == true and
  ([.emergency.enabled.packageInfo[].name | select(. == "pi-emergency")] | length) == 1 and
  ([.emergency.enabled.packageInfo[].name | select(. == "pi-emergency-full")] | length) == 1 and
  .emergency.enabled.emergencySettings.extensions == .emergency.enabled.extensionPaths and
  .emergency.enabled.emergencySettings.prompts == .emergency.enabled.normalSettings.prompts and
  .emergency.enabled.emergencySettings.defaultProvider == .emergency.enabled.normalSettings.defaultProvider and
  .emergency.enabled.emergencySettings.defaultModel == .emergency.enabled.normalSettings.defaultModel and
  .emergency.enabled.emergencySettings.defaultThinkingLevel == .emergency.enabled.normalSettings.defaultThinkingLevel and
  .emergency.disabled.optionEnabled == false and
  .emergency.disabled.emergencyPackageCount == 0 and
  (.emergency.disabled.emergencyFiles | length) == 0
' <<<"$result" >/dev/null

AGENT_TYPES_VALIDATOR=$(jq -r '.pi.catalog.agents.reviewer.childExtensionContributions[0] | sub("/agent_artifact.ts$"; "/utilities/agent_types.ts")' <<<"$result") \
GENERATED_AGENT_CATALOG=$(jq -c '.pi.catalog' <<<"$result") \
GENERATED_ORCHESTRATION=$(jq -c '.pi.orchestration' <<<"$result") \
GENERATED_EXTENSION_KEYBINDINGS=$(jq -c '.pi.extensionKeybindings' <<<"$result") \
GENERATED_WEB_RETRIEVAL=$(jq -c '.pi.webRetrieval' <<<"$result") \
PACKAGE_ROOT="$package_root" node --input-type=module -e '
    import assert from "node:assert/strict";
    import { pathToFileURL } from "node:url";
    const utilities = `${process.env.PACKAGE_ROOT}/extensions_src/utilities`;
    const { validateAgentCatalog, validateOrchestrationConfig } = await import(pathToFileURL(process.env.AGENT_TYPES_VALIDATOR).href);
    const { validateExtensionKeybindings } = await import(pathToFileURL(`${utilities}/extension_keybindings.ts`).href);
    const { validateWebRetrievalRuntimeConfig } = await import(pathToFileURL(`${utilities}/web_retrieval_types.ts`).href);
    const catalog = JSON.parse(process.env.GENERATED_AGENT_CATALOG);
    validateAgentCatalog(catalog);
    validateOrchestrationConfig(JSON.parse(process.env.GENERATED_ORCHESTRATION));
    const oneSidedDrift = structuredClone(catalog);
    oneSidedDrift.agents.codex.harnessOptions.mode = "agent";
    assert.throws(() => validateAgentCatalog(oneSidedDrift), /settled codex capability/u);
    validateExtensionKeybindings(JSON.parse(process.env.GENERATED_EXTENSION_KEYBINDINGS), "generated extension-keybindings.json");

    const projections = JSON.parse(process.env.GENERATED_WEB_RETRIEVAL);
    const expectedProviders = secretPaths => [
      ["parallel-search", "parallel-search", "https://api.parallel.ai/v1/search", secretPaths["parallel-api-key"]],
      ["brave-llm-context", "brave-llm-context", "https://api.search.brave.com/res/v1/llm/context", secretPaths["brave-api-key"]],
      ["brave-web-search", "brave-web-search", "https://api.search.brave.com/res/v1/web/search", secretPaths["brave-free-api-key"]],
      ["exa-search", "exa-search", "https://api.exa.ai/search", secretPaths["exa-api-key"]],
      ["parallel-extract", "parallel-extract", "https://api.parallel.ai/v1beta/extract", secretPaths["parallel-api-key"]],
      ["exa-contents", "exa-contents", "https://api.exa.ai/contents", secretPaths["exa-api-key"]],
    ].map(([id, kind, endpoint, apiKeyFile]) => ({ id, kind, endpoint, apiKeyFile }));
    for (const projection of Object.values(projections)) {
      const config = validateWebRetrievalRuntimeConfig(projection.config);
      assert.deepEqual(config.providers, expectedProviders(projection.secretPaths));
      assert.deepEqual(config.routing, { generalFamilies: { parallel: 5, brave: 1 }, braveProviders: { "brave-llm-context": 2, "brave-web-search": 1 } });
      assert.deepEqual(config.deadlinesMs, { search: 30_000, fetch: 60_000 });
      assert.deepEqual(config.retry, { maxRetries: 1, defaultWaitMs: 1_000 });
    }
    assert.ok(Object.values(projections.all.secretPaths).every(path => typeof path === "string" && path.length > 0));
    assert.deepEqual(projections.home.secretPaths, {
      "parallel-api-key": "/run/secrets/parallel-api-key",
      "brave-api-key": "/run/secrets/brave-api-key",
      "brave-free-api-key": "/run/secrets/brave-free-api-key",
      "exa-api-key": "/run/secrets/exa-api-key",
    });
    assert.deepEqual(projections.homePartial.secretPaths, { "parallel-api-key": projections.home.secretPaths["parallel-api-key"], "brave-api-key": null, "brave-free-api-key": null, "exa-api-key": projections.home.secretPaths["exa-api-key"] });
    assert.deepEqual(projections.partial.secretPaths, { "parallel-api-key": projections.all.secretPaths["parallel-api-key"], "brave-api-key": null, "brave-free-api-key": null, "exa-api-key": projections.all.secretPaths["exa-api-key"] });
    assert.ok(Object.values(projections.null.secretPaths).every(path => path === null));
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

printf 'Configuration contracts passed (one negative and one positive nix eval)\n'
