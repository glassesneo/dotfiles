def fail [message: string] {
  error make {msg: $message}
}

def assert-contract [condition: bool, concern: string] {
  if not $condition { fail $"($concern): contract failed" }
}

def pass [concern: string] {
  print $"pass: ($concern)"
}

def command-ok [result: record, concern: string] {
  if $result.exit_code != 0 {
    print --stderr $result.stderr
    fail $"($concern): command exited with ($result.exit_code)"
  }
}

def main [] {
  let configuration_source = ($env.CONFIGURATION_SOURCE? | default "")
  let fixture = ($env.CONFIGURATION_FIXTURE? | default "")
  let package_root = ($env.PACKAGE_ROOT? | default "")
  assert-contract ($configuration_source | is-not-empty) "filtered-configuration-source"
  assert-contract ($fixture | is-not-empty) "static-fixture"
  assert-contract ($package_root | is-not-empty) "node-package-root"

  let evaluation = (
    ^nix eval --impure --json --expr
      'import (builtins.getEnv "CONFIGURATION_FIXTURE") { configurationSource = builtins.getEnv "CONFIGURATION_SOURCE"; }'
    | complete
  )
  command-ok $evaluation "normal-projection"
  let result = ($evaluation.stdout | from json)
  assert-contract ($result.schemaVersion == 1) "fixture-schema"

  assert-contract ($result.generated.colorschemeSelectors | values | all {|value| $value }) "colorscheme-owner-projection"
  pass "colorscheme-owner-projection"

  let pi = $result.generated.pi
  let enabled_question_extensions = ($pi.enabledQuestion.extensionPaths | each {|path| $path | path basename })
  let disabled_question_extensions = ($pi.disabledQuestion.extensionPaths | each {|path| $path | path basename })
  assert-contract ($enabled_question_extensions | any {|name| $name == "question.ts" }) "question-extension-enabled"
  assert-contract (not ($disabled_question_extensions | any {|name| $name == "question.ts" })) "question-extension-disabled"
  assert-contract (($pi.enabledQuestion.modes.modes | values | any {|mode| $mode.tools | any {|tool| $tool == "question" } })) "question-tool-enabled"
  assert-contract (not ($pi.disabledQuestion.modes.modes | values | any {|mode| $mode.tools | any {|tool| $tool == "question" } })) "question-tool-disabled"
  assert-contract (($pi.extensionKeybindings.features | get historyViewer | get exit | first) == "f12") "native-key-alias"
  let parent_identity_invocation = 'pi-mesh-return-parent\s+--binding\s+#\{q:client_name\}\s+#\{q:session_id\}\s+#\{q:window_id\}'
  assert-contract ($pi.navigationTmux =~ $parent_identity_invocation) "tmux-parent-identity-arguments"
  assert-contract ($pi.darwinTmux =~ $parent_identity_invocation) "darwin-tmux-parent-identity-arguments"
  pass "generated-pi-projections"

  let web = $result.generated.webRetrieval
  for projection in [
    {id: home-partial, selected: [parallel-api-key exa-api-key], value: $web.homePartial}
    {id: darwin-partial, selected: [parallel-api-key exa-api-key], value: $web.darwinPartial}
    {id: home-disabled, selected: [], value: $web.homeDisabled}
    {id: darwin-disabled, selected: [], value: $web.darwinDisabled}
  ] {
    for secret in ($projection.value.secretPaths | transpose name path) {
      if $secret.name in $projection.selected {
        assert-contract ($secret.path != null and ($secret.path | is-not-empty)) $"web-($projection.id)-selected-($secret.name)"
      } else {
        assert-contract ($secret.path == null) $"web-($projection.id)-omitted-($secret.name)"
      }
    }
  }
  pass "web-secret-projections"

  let nushell = $result.generated.nushellSecrets
  for projection in [
    {id: partial, selected: [ai-mop-api-key], value: $nushell.homePartial}
    {id: disabled, selected: [], value: $nushell.homeDisabled}
  ] {
    for credential in ($projection.value.credentials | transpose name value) {
      let selected = $credential.name in $projection.selected
      let variable_marker = (['$env.' $credential.value.variable] | str join)
      if $selected {
        assert-contract ($credential.value.path != null and ($projection.value.extraEnv | str contains $credential.value.path)) $"nushell-($projection.id)-($credential.name)-path"
        assert-contract ($projection.value.extraEnv | str contains $variable_marker) $"nushell-($projection.id)-($credential.name)-variable"
      } else {
        assert-contract ($credential.value.path == null and not ($projection.value.extraEnv | str contains $variable_marker)) $"nushell-($projection.id)-($credential.name)-omitted"
      }
    }
  }
  pass "nushell-secret-projections"

  let secrets = $result.generated.secrets
  assert-contract ($secrets.wholeFile.upstream.source == $secrets.wholeFile.requested.source) "whole-file-source"
  assert-contract ($secrets.wholeFile.upstream.format == $secrets.wholeFile.requested.format) "whole-file-format"
  assert-contract ($secrets.wholeFile.upstream.mode == $secrets.wholeFile.requested.mode) "whole-file-mode"
  assert-contract ($secrets.wholeFile.requested.key == null and $secrets.wholeFile.upstream.key == "") "whole-file-null-key"
  pass "whole-file-secret-projection"

  let darwin_activation = $secrets.darwinHeadlessActivation
  assert-contract ($darwin_activation.domain == "user") "darwin-sops-user-domain"
  assert-contract ($darwin_activation.sessionType == "Background") "darwin-sops-background-session"
  assert-contract ("setupLaunchAgents" in $darwin_activation.after) "darwin-sops-launchagent-order"
  assert-contract ($darwin_activation.data | str contains 'launchctl kickstart -k') "darwin-sops-kickstart"
  assert-contract ($darwin_activation.data | str contains 'user/$(id -u)/org.nix-community.home.sops-nix') "darwin-sops-user-target"
  assert-contract (not ($darwin_activation.data | str contains "gui/")) "darwin-sops-no-gui-target"
  pass "darwin-headless-sops-activation"

  let darwin_empty = $secrets.darwinEmptyActivation
  assert-contract (not $darwin_empty.hasLaunchAgent and not $darwin_empty.hasActivation) "darwin-empty-sops-runtime-outputs"
  pass "darwin-empty-sops-activation"

  let validator_source = r#'
    import assert from "node:assert/strict";
    import { pathToFileURL } from "node:url";

    const catalog = JSON.parse(process.env.GENERATED_AGENT_CATALOG);
    const orchestration = JSON.parse(process.env.GENERATED_ORCHESTRATION);
    const keybindings = JSON.parse(process.env.GENERATED_EXTENSION_KEYBINDINGS);
    const enabledModes = JSON.parse(process.env.GENERATED_ENABLED_MODES);
    const disabledModes = JSON.parse(process.env.GENERATED_DISABLED_MODES);
    const projections = JSON.parse(process.env.GENERATED_WEB_RETRIEVAL);
    const utilities = `${process.env.PACKAGE_ROOT}/extensions_src/utilities`;
    const { validateAgentCatalog, validateOrchestrationConfig } = await import(pathToFileURL(process.env.AGENT_TYPES_VALIDATOR).href);
    const { validateModeConfig } = await import(pathToFileURL(`${utilities}/mode_types.ts`).href);
    const { validateExtensionKeybindings } = await import(pathToFileURL(`${utilities}/extension_keybindings.ts`).href);
    const { validateWebRetrievalRuntimeConfig } = await import(pathToFileURL(`${utilities}/web_retrieval_types.ts`).href);

    validateAgentCatalog(catalog);
    validateOrchestrationConfig(orchestration);
    validateModeConfig(enabledModes);
    validateModeConfig(disabledModes);
    validateExtensionKeybindings(keybindings, "generated extension-keybindings.json");

    const secretForProvider = {
      "parallel-search": "parallel-api-key",
      "brave-llm-context": "brave-api-key",
      "brave-web-search": "brave-free-api-key",
      "exa-search": "exa-api-key",
      "parallel-extract": "parallel-api-key",
      "exa-contents": "exa-api-key",
    };
    for (const projection of Object.values(projections)) {
      const config = validateWebRetrievalRuntimeConfig(projection.config);
      for (const provider of config.providers) {
        assert.equal(provider.apiKeyFile, projection.secretPaths[secretForProvider[provider.kind]]);
      }
    }
  '#
  let validator_path = ($env.TMPDIR | path join configuration-contract-validator.mjs)
  $validator_source | save --force $validator_path
  let agent_types_validator = (
    $pi.catalog.agents.reviewer.childExtensionContributions
    | first
    | str replace --regex 'agent_artifact\.ts$' 'utilities/agent_types.ts'
  )
  let validator = with-env {
    AGENT_TYPES_VALIDATOR: $agent_types_validator
    GENERATED_AGENT_CATALOG: ($pi.catalog | to json --raw)
    GENERATED_ORCHESTRATION: ($pi.orchestration | to json --raw)
    GENERATED_EXTENSION_KEYBINDINGS: ($pi.extensionKeybindings | to json --raw)
    GENERATED_ENABLED_MODES: ($pi.enabledQuestion.modes | to json --raw)
    GENERATED_DISABLED_MODES: ($pi.disabledQuestion.modes | to json --raw)
    GENERATED_WEB_RETRIEVAL: ($web | to json --raw)
    PACKAGE_ROOT: $package_root
  } { ^node $validator_path | complete }
  command-ok $validator "generated-runtime-validators"
  pass "generated-runtime-validators"

  let emergency = $result.generated.emergency
  assert-contract (($emergency.enabled.links | columns | is-not-empty)) "emergency-shared-links"
  pass "emergency-shared-links"
  let gc_roots = ($env.TMPDIR | path join configuration-contract-gc-roots)
  rm --recursive --force $gc_roots
  mkdir $gc_roots
  pass "emergency-root-directory"
  for link in ($emergency.enabled.links | transpose name metadata) {
    let root = ($gc_roots | path join $"link-($link.name)")
    let realized = (^nix-store --realise $link.metadata.drvPath --add-root $root | complete)
    command-ok $realized $"emergency-link-realization-($link.name)"
    let target = (^readlink $link.metadata.source | str trim)
    assert-contract ($target == $link.metadata.target) $"emergency-link-target-($link.name)"
  }

  for package_name in [pi-emergency pi-emergency-full] {
    let package = ($emergency.enabled.packages | get $package_name)
    let root = ($gc_roots | path join $package_name)
    let realized = (^nix-store --realise $package.drvPath --add-root $root | complete)
    command-ok $realized $"emergency-package-realization-($package_name)"
    let script = (open --raw ($package.path | path join bin $package_name))
    assert-contract ($script =~ '(?s)exec\s+\S*/bin/pi\b.*"\$@"') $"emergency-caller-arguments-($package_name)"
    assert-contract ($script | str contains "--no-approve") $"emergency-approval-flag-($package_name)"
    let isolation_flags = ["--no-extensions" "--no-skills" "--no-prompt-templates" "--no-themes"]
    if $package_name == "pi-emergency" {
      for flag in $isolation_flags {
        assert-contract ($script | str contains $flag) $"emergency-safe-flag-($flag)"
      }
    } else {
      for flag in $isolation_flags {
        assert-contract (not ($script | str contains $flag)) $"emergency-full-omits-safe-flag-($flag)"
      }
    }
  }
  assert-contract (($emergency.disabled.packages | is-empty) and ($emergency.disabled.emergencyFiles | is-empty)) "emergency-disabled-outputs"
  pass "emergency-realization-semantics"

  print "Configuration contracts passed (one semantic nix evaluation)"
}
