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

  let diagnostic = (
    ^nix eval --impure --raw --expr
      'import (builtins.getEnv "CONFIGURATION_FIXTURE") { configurationSource = builtins.getEnv "CONFIGURATION_SOURCE"; mode = "diagnostic"; }'
    | complete
  )
  assert-contract ($diagnostic.exit_code != 0) "combined-keybinding-rejection"
  let diagnostic_output = $"($diagnostic.stdout)($diagnostic.stderr)"
  let diagnostic_categories = [
    {id: grammar, pattern: 'commandPalette\.open=not-a-key'}
    {id: alias-collision, pattern: '(commandPalette\.cancel.*commandPalette\.moveUp|commandPalette\.moveUp.*commandPalette\.cancel).*escape'}
    {id: unknown-action, pattern: 'commandPalette\.typo'}
    {id: required-empty, pattern: 'question\.submit'}
    {id: question-choice-collision, pattern: '(question\.common\.cancel.*question\.choice\.select-and-note|question\.choice\.select-and-note.*question\.common\.cancel).*e'}
    {id: overlapping-context, pattern: '(pi\.app\.clear.*pi\.tui\.editor\.cursorUp|pi\.tui\.editor\.cursorUp.*pi\.app\.clear).*ctrl\+c'}
    {id: tmux-unrepresentable, pattern: 'tmuxPreview\.openFull=clear'}
    {id: direct-native-required-empty, pattern: 'historyViewer\.exit'}
  ]
  for category in $diagnostic_categories {
    assert-contract ($diagnostic_output =~ $category.pattern) $"diagnostic-($category.id)"
    pass $"diagnostic-($category.id)"
  }

  let evaluation = (
    ^nix eval --impure --json --expr
      'import (builtins.getEnv "CONFIGURATION_FIXTURE") { configurationSource = builtins.getEnv "CONFIGURATION_SOURCE"; mode = "normal"; }'
    | complete
  )
  command-ok $evaluation "normal-projection"
  let result = ($evaluation.stdout | from json)
  assert-contract ($result.schemaVersion == 1) "fixture-schema"

  for rejection in ($result.rejections | transpose id evaluation) {
    assert-contract ($rejection.evaluation.success == false) $"rejection-($rejection.id)"
    pass $"rejection-($rejection.id)"
  }

  let pi = $result.generated.pi
  let extension_basenames = ($pi.defaultExtensionPaths | each {|path| $path | path basename })
  assert-contract (($extension_basenames | any {|name| $name == "question.ts" })) "question-extension-enabled"
  assert-contract (not ($pi.questionDisabled.extensionPaths | any {|path| ($path | path basename) == "question.ts" })) "question-extension-disabled"
  assert-contract ($pi.modes.defaultMode == "recon") "mode-default"
  assert-contract ($pi.modes.modes.recon.allowAllTools == false and $pi.modes.modes.ops.allowAllTools == true) "mode-capability-delta"
  assert-contract (($pi.modes.modes.recon.tools | any {|tool| $tool == "question" })) "question-tool-enabled"
  assert-contract (not ($pi.questionDisabled.modes.modes.recon.tools | any {|tool| $tool == "question" })) "question-tool-disabled"
  let overridden_model = "gpt-5.6-sol"
  assert-contract (($pi.models.providers.openai-codex.modelOverrides | get $overridden_model | get contextWindow) == 1050000) "model-override"
  assert-contract ($pi.catalog.agents.codex.harness == "codex") "codex-harness"
  assert-contract ($pi.catalog.agents.codex.harnessOptions.mode == "read-only") "codex-read-only"
  assert-contract ($pi.catalog.agents.codex.harnessOptions.permissionPolicy == "reject") "codex-permission-policy"
  assert-contract ($pi.catalog.agents.codex.harnessOptions.webSearch == "cached") "codex-web-search"
  assert-contract (($pi.extensionKeybindings.features | get historyViewer | get exit | first) == "f12") "native-key-alias"
  assert-contract (($pi.extensionKeybindings.features | columns | any {|name| $name == "meshPalette" })) "mesh-keybindings-present"
  assert-contract (not ($pi.extensionKeybindings.features | columns | any {|name| $name == "subagentPalette" or $name == "subagentNavigation" })) "legacy-keybindings-absent"
  assert-contract ($pi.navigationRuntime.parentNavigationHint == "F11 F10: parent · /parent") "tmux-navigation-hint"
  assert-contract ($pi.navigationTmux | str contains "bind-key f10") "tmux-navigation-binding"
  let parent_identity_invocation = 'pi-mesh-return-parent\s+--binding\s+#\{q:client_name\}\s+#\{q:session_id\}\s+#\{q:window_id\}'
  assert-contract ($pi.navigationTmux =~ $parent_identity_invocation) "tmux-parent-identity-arguments"
  assert-contract ($pi.navigationTmux | str contains '#{==:#{@pi_mesh_schema},1}') "tmux-schema-representation"
  assert-contract (not ($pi.navigationTmux | str contains "pi-subagent-return-parent")) "legacy-tmux-command-absent"
  assert-contract ($pi.darwinTmux =~ $parent_identity_invocation) "darwin-tmux-parent-identity-arguments"
  pass "generated-pi-behavior"

  let web = $result.generated.webRetrieval
  for projection in [
    {id: home, value: $web.home}
    {id: darwin, value: $web.darwin}
  ] {
    assert-contract ($projection.value.secretPaths | values | all {|path| $path != null and ($path | is-not-empty) }) $"($projection.id)-default-secret-projection"
  }
  for projection in [
    {id: home, value: $web.homePartial}
    {id: darwin, value: $web.darwinPartial}
  ] {
    let paths = $projection.value.secretPaths
    assert-contract ($paths.parallel-api-key != null and $paths.exa-api-key != null) $"($projection.id)-partial-selected-secrets"
    assert-contract ($paths.brave-api-key == null and $paths.brave-free-api-key == null) $"($projection.id)-partial-omitted-secrets"
  }
  for projection in [
    {id: home, value: $web.homeDisabled}
    {id: darwin, value: $web.darwinDisabled}
  ] {
    assert-contract ($projection.value.secretPaths | values | all {|path| $path == null }) $"($projection.id)-disabled-secrets"
  }
  pass "web-secret-projections"

  let nushell = $result.generated.nushellSecrets
  for projection in [
    {id: default, selected: [ai-mop-api-key iniad-id iniad-password], value: $nushell.home}
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
  let expected_default_scalar_secret_names = [
    gemini-api-key
    ai-mop-api-key
    brave-api-key
    brave-free-api-key
    parallel-api-key
    exa-api-key
    openrouter-api-key
    cerebras-api-key
    google-cloud-api-key
    zai-api-key
    iniad-id
    iniad-password
  ]
  let default_scalars = $secrets.defaultScalarDeclarations
  for projection in ($default_scalars.projections | transpose id declarations) {
    assert-contract (($projection.declarations | columns | sort) == ($expected_default_scalar_secret_names | sort)) $"($projection.id)-default-scalar-secret-names"
    for declaration in ($projection.declarations | transpose name value) {
      assert-contract ($declaration.value.key == $declaration.name) $"($projection.id)-default-scalar-secret-key-($declaration.name)"
      assert-contract (
        $declaration.value.source == $default_scalars.expected.source
        and $declaration.value.format == $default_scalars.expected.format
        and $declaration.value.mode == $default_scalars.expected.mode
      ) $"($projection.id)-default-scalar-secret-metadata-($declaration.name)"
    }
  }
  pass "default-scalar-secret-declarations"

  assert-contract ($secrets.wholeFile.upstream.source == $secrets.wholeFile.requested.source) "whole-file-source"
  assert-contract ($secrets.wholeFile.upstream.format == $secrets.wholeFile.requested.format) "whole-file-format"
  assert-contract ($secrets.wholeFile.upstream.mode == $secrets.wholeFile.requested.mode) "whole-file-mode"
  assert-contract ($secrets.wholeFile.requested.key == null and $secrets.wholeFile.upstream.key == "") "whole-file-null-key"
  pass "whole-file-secret-projection"

  let darwin_root_repository_declarations = ($secrets.darwinRootDeclarationNames | where {|name| $name in $expected_default_scalar_secret_names })
  assert-contract ($darwin_root_repository_declarations | is-empty) "darwin-root-secret-ownership"
  pass "darwin-secret-ownership"

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
    const projections = JSON.parse(process.env.GENERATED_WEB_RETRIEVAL);
    const utilities = `${process.env.PACKAGE_ROOT}/extensions_src/utilities`;
    const { validateAgentCatalog, validateOrchestrationConfig } = await import(pathToFileURL(process.env.AGENT_TYPES_VALIDATOR).href);
    const { validateExtensionKeybindings } = await import(pathToFileURL(`${utilities}/extension_keybindings.ts`).href);
    const { validateWebRetrievalRuntimeConfig } = await import(pathToFileURL(`${utilities}/web_retrieval_types.ts`).href);

    validateAgentCatalog(catalog);
    validateOrchestrationConfig(orchestration);
    validateExtensionKeybindings(keybindings, "generated extension-keybindings.json");
    for (const projection of Object.values(projections)) {
      validateWebRetrievalRuntimeConfig(projection.config);
    }

    const drift = structuredClone(catalog);
    drift.agents.codex.harnessOptions.mode = "agent";
    assert.throws(() => validateAgentCatalog(drift), /settled codex capability/u);

    const representative = validateWebRetrievalRuntimeConfig(projections.home.config);
    assert.deepEqual(representative.providers.map(({id, kind, endpoint}) => ({id, kind, endpoint})), [
      {id: "parallel-search", kind: "parallel-search", endpoint: "https://api.parallel.ai/v1/search"},
      {id: "brave-llm-context", kind: "brave-llm-context", endpoint: "https://api.search.brave.com/res/v1/llm/context"},
      {id: "brave-web-search", kind: "brave-web-search", endpoint: "https://api.search.brave.com/res/v1/web/search"},
      {id: "exa-search", kind: "exa-search", endpoint: "https://api.exa.ai/search"},
      {id: "parallel-extract", kind: "parallel-extract", endpoint: "https://api.parallel.ai/v1beta/extract"},
      {id: "exa-contents", kind: "exa-contents", endpoint: "https://api.exa.ai/contents"},
    ]);
    assert.deepEqual(representative.routing, {generalFamilies: {parallel: 5, brave: 1}, braveProviders: {"brave-llm-context": 2, "brave-web-search": 1}});
    assert.deepEqual(representative.deadlinesMs, {search: 30_000, fetch: 60_000});
    assert.deepEqual(representative.retry, {maxRetries: 1, defaultWaitMs: 1_000});

    for (const projection of Object.values(projections)) {
      const config = validateWebRetrievalRuntimeConfig(projection.config);
      const expected = [
        projection.secretPaths["parallel-api-key"],
        projection.secretPaths["brave-api-key"],
        projection.secretPaths["brave-free-api-key"],
        projection.secretPaths["exa-api-key"],
        projection.secretPaths["parallel-api-key"],
        projection.secretPaths["exa-api-key"],
      ];
      assert.deepEqual(config.providers.map(provider => provider.apiKeyFile), expected);
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
    GENERATED_WEB_RETRIEVAL: ($web | to json --raw)
    PACKAGE_ROOT: $package_root
  } { ^node $validator_path | complete }
  command-ok $validator "generated-runtime-validators"
  pass "generated-runtime-validators"
  pass "web-retrieval-runtime-semantics"

  let emergency = $result.generated.emergency
  assert-contract ($emergency.enabled.optionEnabled == true) "emergency-enabled"
  assert-contract ($emergency.enabled.emergencySettings.extensions == $emergency.enabled.extensionPaths) "emergency-extension-settings"
  assert-contract ($emergency.enabled.emergencySettings.prompts == $emergency.enabled.normalSettings.prompts) "emergency-prompt-settings"
  assert-contract ($emergency.enabled.emergencySettings.defaultProvider == $emergency.enabled.normalSettings.defaultProvider) "emergency-default-provider"
  assert-contract ($emergency.enabled.emergencySettings.defaultModel == $emergency.enabled.normalSettings.defaultModel) "emergency-default-model"
  assert-contract ($emergency.enabled.emergencySettings.defaultThinkingLevel == $emergency.enabled.normalSettings.defaultThinkingLevel) "emergency-thinking-level"
  assert-contract ($emergency.disabled.optionEnabled == false) "emergency-disabled"
  assert-contract (($emergency.disabled.packages | length) == 0 and ($emergency.disabled.emergencyFiles | length) == 0) "emergency-disabled-outputs"

  let gc_roots = ($env.TMPDIR | path join configuration-contract-gc-roots)
  mkdir $gc_roots
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
    assert-contract ($script | str contains "PI_CODING_AGENT_DIR=") $"emergency-directory-($package_name)"
    assert-contract ($script | str contains "/.pi/emergency-agent") $"emergency-config-path-($package_name)"
    assert-contract ($script | str contains "PI_CODING_AGENT_SESSION_DIR=") $"emergency-session-directory-($package_name)"
    assert-contract ($script | str contains "/.pi/agent/sessions") $"emergency-session-path-($package_name)"
    assert-contract ($script | str contains "/bin/pi") $"emergency-pi-executable-($package_name)"
    assert-contract ($script =~ '(?s)exec\s+\S*/bin/pi\b.*"\$@"') $"emergency-caller-arguments-($package_name)"
    assert-contract ($script | str contains "--no-approve") $"emergency-approval-flag-($package_name)"
    let safe_only_flags = ["--no-extensions" "--no-skills" "--no-prompt-templates" "--no-themes"]
    if $package_name == "pi-emergency" {
      for flag in $safe_only_flags {
        assert-contract ($script | str contains $flag) $"emergency-safe-flag-($flag)"
      }
    } else {
      for flag in $safe_only_flags {
        assert-contract (not ($script | str contains $flag)) $"emergency-full-omits-safe-flag-($flag)"
      }
    }
  }
  pass "emergency-realization-semantics"

  print "Configuration contracts passed (one diagnostic and one normal nix eval)"
}
