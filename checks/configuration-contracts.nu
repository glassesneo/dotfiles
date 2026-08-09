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
  let full_home_paths = {
    parallel-api-key: "/run/secrets/parallel-api-key"
    brave-api-key: "/run/secrets/brave-api-key"
    brave-free-api-key: "/run/secrets/brave-free-api-key"
    exa-api-key: "/run/secrets/exa-api-key"
  }
  let partial_home_paths = {
    parallel-api-key: "/run/secrets/parallel-api-key"
    brave-api-key: null
    brave-free-api-key: null
    exa-api-key: "/run/secrets/exa-api-key"
  }
  assert-contract ($web.home.secretPaths == $full_home_paths) "home-secret-projection"
  assert-contract ($web.homePartial.secretPaths == $partial_home_paths) "home-partial-secret-projection"
  assert-contract ($web.darwin.secretPaths | values | all {|path| $path != null and ($path | is-not-empty) }) "darwin-secret-projection"
  assert-contract ($web.darwinPartial.secretPaths.parallel-api-key == $web.darwin.secretPaths.parallel-api-key) "darwin-partial-selected-parallel"
  assert-contract ($web.darwinPartial.secretPaths.exa-api-key == $web.darwin.secretPaths.exa-api-key) "darwin-partial-selected-exa"
  assert-contract ($web.darwinPartial.secretPaths.brave-api-key == null and $web.darwinPartial.secretPaths.brave-free-api-key == null) "darwin-partial-omitted-secrets"
  assert-contract ($web.darwinDisabled.secretPaths | values | all {|path| $path == null }) "darwin-disabled-secrets"
  pass "web-secret-projections"

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
