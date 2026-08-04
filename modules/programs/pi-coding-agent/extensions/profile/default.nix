{
  delib,
  lib,
  ...
}: let
  moduleName = "programs.pi-coding-agent.profile";
  profileType = delib.submodule {
    options = with delib; {
      model = noDefault (strOption null);
      availability = listOfOption (lib.types.enum ["top-level" "subagent"]) [];
      description = noDefault (strOption null);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      allowAllTools = boolOption false;
      tools = listOfOption str [];
      instructions = allowNull (strOption null);
      extensions = attrsOfOption attrs {};
    };
  };
  cleanProfile = profile: lib.filterAttrs (_: value: value != null) profile;
  # Internal immutable identity. Keep an existing ID when its readable profile key is renamed.
  profileIds = {
    full = "28df1eab-0974-48e8-a82c-fd55c38db93a";
    taskmaster = "d4c63074-3512-4dc6-b10a-120544570fd1";
    artisan = "a8535230-389d-41f7-b4c2-40e14e49ae95";
    scout = "960e40e8-3d80-4a9a-ae8f-871911a125ef";
    operator = "c7a01e0c-896d-41e0-a23f-37c8f56bcf53";
    cursor-implementer = "64e0f39f-92c7-4b41-b6db-5a667d103915";
    explorer = "d1353104-3f41-4e53-a23a-b9fb2d445675";
    tester = "e0bf8181-2cbb-430b-b974-9af15266669f";
    reviewer = "9a3a45b8-f2df-4b43-97d9-e9abe62e2e0a";
    focused-reviewer = "a18481a8-7c77-4baf-9280-220505bf9c63";
    dissent-reviewer = "d7d333ba-df8c-460d-a55b-53daee445259";
  };
  explorerDelegationInstructions = ''
    Use the explorer subagent for bounded codebase evidence gathering after the user's objective and main issues are sufficiently clear. A bounded exploration question may be useful before or during design, before planning, during other work, or during review; when intent is still ambiguous, delegate only a narrow feasibility question. First inspect likely entrypoints or core interfaces with a small sizing pass, without turning that pass into broad exploration.

    Explore directly when the answer is likely within a few files, immediately affects the next user interaction, requires revising a design hypothesis while reading, concerns the design's central code, would lose important nuance through summarization, or is already covered by current context. Prefer explorer when the scope is broad, splits into independent directions, can be localized as a question, contains much investigation but little judgment, requires comprehensive usage or impact evidence, or can run while you make progress elsewhere. For broad design-critical questions, use a hybrid: inspect the central code yourself and verify the explorer's important evidence. Run multiple explorers in parallel only for distinct independent questions; never duplicate the same broad question.

    When delegating, localize the investigation rather than passing the whole parent task or unrelated conversation history. Verify, compress, and integrate the result yourself. You retain ownership of user intent, problem framing, overall design, final decisions, user dialogue, and task progress.
  '';
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "profile" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/profile.ts"]);
        defaultProfile = strOption "scout";
        profileCycle = listOfOption str ["scout" "taskmaster" "artisan" "operator" "reviewer"];
        promptRoutes = attrsOfOption str {};
        defaultTools = listOfOption str [];
        profiles = attrsOfOption profileType {};
        facetOwners = attrsOfOption str {};
      });

    myconfig.always = {cfg, ...}: {
      programs.pi-coding-agent.keybindings.contributions.profile = {
        enabled = cfg.enable;
        actions.cycle = {
          defaultKeys = [];
          contexts = ["app.global"];
          required = false;
          target = "shortcut";
        };
      };
      programs.pi-coding-agent.profile = {
        defaultTools = ["read" "grep" "find" "ls" "bash"];
        promptRoutes = {
          spec-design = "scout";
          idea-design = "scout";
          act = "artisan";
          impl = "taskmaster";
          execute = "taskmaster";
          operate = "operator";
          review = "reviewer";
        };
        profiles = {
          full = {
            model = "openai-codex/gpt-5.6-sol";
            availability = ["top-level" "subagent"];
            description = "Use for work that needs broad coding capability.";
            thinkingLevel = "medium";
            allowAllTools = true;
            tools = [];
            instructions = explorerDelegationInstructions;
            extensions = {};
          };
          taskmaster = {
            model = "openai-codex/gpt-5.6-sol";
            availability = ["top-level" "subagent"];
            description = "Use for source-changing implementation, repair, and implementation lifecycle work.";
            thinkingLevel = "medium";
            allowAllTools = false;
            tools = ["write" "edit"];
            instructions = ''
              You are a source-changing implementation specialist. Default to source-implementation for a bounded source-only handoff and implementation-lifecycle for a complete approved-design lifecycle. If the selected Skill or its required input is unavailable, report what is missing and stop.
            '';
            extensions = {};
          };
          artisan = {
            model = "openai-codex/gpt-5.6-luna";
            availability = ["top-level"];
            description = "Use to implement bounded changes with self-validation and optional focused review remediation.";
            thinkingLevel = "xhigh";
            allowAllTools = false;
            tools = ["write" "edit"];
            instructions = ''
              You are a command-independent source-changing artisan. Follow the user's current objective or a small approved design and execute lightweight-implementation-lifecycle in direct mode unless the current request explicitly selects another mode. Own bounded implementation, proportionate self-validation, and evidence-backed repair. Do not delegate source implementation or validation. Use one reviewer in solo-only mode only when review is explicitly requested, then own finding triage, source repair, validation, and the terminal outcome. Stop rather than materially expanding the agreed scope or scale. Return concrete changed-file, diff, validation, deviation, review, and unresolved-risk evidence required by the selected lifecycle mode.
            '';
            extensions = {};
          };
          scout = {
            model = "openai-codex/gpt-5.6-sol";
            availability = ["top-level" "subagent"];
            description = "Use for read-only investigation, evidence gathering, and collaborative dialogue.";
            thinkingLevel = "high";
            allowAllTools = false;
            tools = [];
            instructions = ''
              You are a read-only investigation and collaborative-dialogue specialist. Follow the user's current objective without requiring a command. Use ideation-dialogue for open, preference-led shaping and intent-elicitation to draw out an outcome the user already substantially holds. Investigate directly when neither dialogue mode is needed; artifact creation is not a prerequisite for either dialogue mode. Preserve user-owned decisions and return evidence, explicit uncertainty, or the requested deliverable.

              ${explorerDelegationInstructions}
            '';
            extensions = {};
          };
          operator = {
            model = "openai-codex/gpt-5.6-sol";
            availability = ["top-level" "subagent"];
            description = "Use to decompose work, delegate local objectives, verify evidence, and own the parent outcome.";
            thinkingLevel = "high";
            allowAllTools = false;
            tools = [];
            instructions = ''
              You are a delegation and assurance operator. Default to implementation-lifecycle in delegated-reviewed mode for an approved-design lifecycle, honoring an explicit implementation-role choice and otherwise selecting taskmaster or cursor-implementer from the task contract. You do not change source or configuration directly. If the selected Skill or its required input is unavailable, report what is missing and stop.
            '';
            extensions = {};
          };
          cursor-implementer = {
            model = "cursor/cursor-grok-4.5-high-fast";
            availability = ["subagent"];
            description = "Use for bounded source implementation and remediation through Cursor Agent.";
            thinkingLevel = null;
            allowAllTools = false;
            tools = [];
            instructions = ''
              Implement the delegated bounded source change in the current repository workspace. Follow repository guidance and remain within the supplied objective and constraints. Inspect the resulting diff and run proportionate validation. Return changed files, validation evidence, any deviation from the handoff, and unresolved risks or blockers.
            '';
            extensions = {};
          };
          explorer = {
            model = "openai-codex/gpt-5.6-luna";
            availability = ["subagent"];
            description = "Use for source-read-only codebase exploration that returns evidence for one parent-localized question.";
            thinkingLevel = "medium";
            allowAllTools = false;
            tools = [];
            instructions = ''
              You are a read-only explorer subagent. Default to codebase-exploration for one bounded investigation handoff. If the Skill or required local question is unavailable, report what is missing and stop.
            '';
            extensions = {};
          };
          tester = {
            model = "openai-codex/gpt-5.6-luna";
            availability = ["top-level" "subagent"];
            description = "Use for focused, broad, or full automated validation without changing repository source.";
            thinkingLevel = "medium";
            allowAllTools = false;
            tools = [];
            instructions = ''
              You are a read-only validation specialist. Default to implementation-validation for the caller's explicit objective and requested focused, broad, or full level. If the Skill or its required handoff input is unavailable, report what is missing and stop.
            '';
            extensions = {};
          };
          reviewer = {
            model = "openai-codex/gpt-5.6-sol";
            availability = ["top-level" "subagent"];
            description = "Use for adaptive read-only review that is solo-biased and escalates only on concrete hard-risk evidence.";
            thinkingLevel = "high";
            allowAllTools = false;
            tools = [];
            instructions = ''
              You are a command-independent read-only review specialist. Default to adaptive-review in auto mode for a defined review target, including standalone review without a design or implementation report, and honor an explicit mode override. If the Skill or its required target is unavailable, report what is missing and stop.
            '';
            extensions = {};
          };
          focused-reviewer = {
            model = "openai-codex/gpt-5.6-terra";
            availability = ["subagent"];
            description = "Use for a read-only review limited to a caller-specified lens; include the lens, review target, and higher-level design or implementation report in the delegated prompt.";
            thinkingLevel = "medium";
            allowAllTools = false;
            tools = [];
            instructions = ''
              Review only the caller-specified lens and target without changing source or configuration. Return severity-ordered findings with precise evidence, then residual risks, skipped areas, and verification gaps. Do not broaden into orchestration or persist a review report.
            '';
            extensions = {};
          };
          dissent-reviewer = {
            model = "openai-codex/gpt-5.6-luna";
            availability = ["subagent"];
            description = "Use once to challenge tentative review findings, severity, evidence, and uncovered perspectives from a bounded dossier.";
            thinkingLevel = "high";
            allowAllTools = false;
            tools = [];
            instructions = ''
              Independently challenge the supplied bounded review dossier without changing source or configuration. For each disputed item, state supported, weakened, rejected, or severity-adjusted with evidence; identify material missed perspectives and remaining uncertainty. Do not repeat the full review or persist a report.
            '';
            extensions = {};
          };
        };
      };
    };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      profileNames = builtins.attrNames cfg.profiles;
      profiles = builtins.attrValues cfg.profiles;
      runtimeWhitespace = map builtins.fromJSON [
        ''"\u0009"''
        ''"\u000a"''
        ''"\u000b"''
        ''"\u000c"''
        ''"\u000d"''
        ''"\u0020"''
        ''"\u00a0"''
        ''"\u1680"''
        ''"\u2000"''
        ''"\u2001"''
        ''"\u2002"''
        ''"\u2003"''
        ''"\u2004"''
        ''"\u2005"''
        ''"\u2006"''
        ''"\u2007"''
        ''"\u2008"''
        ''"\u2009"''
        ''"\u200a"''
        ''"\u2028"''
        ''"\u2029"''
        ''"\u202f"''
        ''"\u205f"''
        ''"\u3000"''
        ''"\ufeff"''
      ];
      nonBlank = value: builtins.replaceStrings runtimeWhitespace (map (_: "") runtimeWhitespace) value != "";
      referencesExist = names: builtins.all (name: builtins.elem name profileNames) names;
      routeCommands = builtins.attrNames cfg.promptRoutes;
      routeProfiles = builtins.attrValues cfg.promptRoutes;
      routeCommandValid = command: nonBlank command && builtins.match "[^/[:space:]]+" command != null;
      knownFacets = builtins.attrNames cfg.facetOwners;
      profileFacetsKnown = profile:
        builtins.all (facet: builtins.elem facet knownFacets) (builtins.attrNames profile.extensions);
      configuredTools = profile: lib.unique (cfg.defaultTools ++ profile.tools);
      childEffectiveTools = profile:
        if builtins.elem "subagent" profile.availability
        then builtins.filter (tool: !(builtins.elem tool myconfig.programs.pi-coding-agent.subagent.childExcludedTools)) (configuredTools profile)
        else configuredTools profile;
      subagentTaskToolsPaired = profile: let
        tools = childEffectiveTools profile;
      in
        profile.allowAllTools
        || (builtins.elem "subagent_run" tools == builtins.elem "subagent_submit" tools);
      topLevel = profile: builtins.elem "top-level" profile.availability;
      availabilityValid = profile: profile.availability != [] && lib.length profile.availability == lib.length (lib.unique profile.availability);
      modelValid = profile: builtins.match "[^/[:space:]]+/[^/[:space:]]+" profile.model != null;
      descriptionValid = profile: nonBlank profile.description && builtins.stringLength profile.description <= 512;
      toolsValid = profile:
        builtins.all nonBlank (
          if profile.allowAllTools
          then profile.tools
          else cfg.defaultTools ++ profile.tools
        );
      instructionsValid = profile: profile.instructions == null || nonBlank profile.instructions;
      serializeProfile = name: profile:
        cleanProfile ((
            if profile.allowAllTools || lib.hasPrefix "cursor/" profile.model
            then profile
            else profile // {tools = lib.unique (cfg.defaultTools ++ profile.tools);}
          )
          // {id = profileIds.${name};});
      profileIdNames = builtins.attrNames profileIds;
      profileIdValues = builtins.attrValues profileIds;
      profileIdValid = id: builtins.match "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}" id != null;
      runtimeConfig = {
        schemaVersion = 4;
        inherit (cfg) defaultProfile profileCycle promptRoutes;
        profiles = lib.mapAttrs serializeProfile cfg.profiles;
      };
    in {
      assertions = [
        {
          assertion = profileNames == profileIdNames && lib.length profileIdValues == lib.length (lib.unique profileIdValues) && builtins.all profileIdValid profileIdValues;
          message = "Pi internal profile IDs must exactly cover profiles and be unique valid opaque UUIDs.";
        }
        {
          assertion = builtins.elem cfg.defaultProfile profileNames && topLevel cfg.profiles.${cfg.defaultProfile};
          message = "Pi defaultProfile must reference an existing top-level profile.";
        }
        {
          assertion = cfg.profileCycle != [] && lib.length cfg.profileCycle == lib.length (lib.unique cfg.profileCycle) && referencesExist cfg.profileCycle && builtins.all (name: topLevel cfg.profiles.${name}) cfg.profileCycle;
          message = "Pi profileCycle must contain one or more unique existing top-level profile names.";
        }
        {
          assertion = builtins.all nonBlank profileNames;
          message = "Pi agent profile names must be non-blank.";
        }
        {
          assertion = builtins.all routeCommandValid routeCommands && referencesExist routeProfiles && builtins.all (name: topLevel cfg.profiles.${name}) routeProfiles;
          message = "Pi promptRoutes must map non-blank command tokens to existing top-level profiles.";
        }
        {
          assertion = builtins.all availabilityValid profiles;
          message = "Pi profile availability must be a non-empty unique list.";
        }
        {
          assertion = builtins.all modelValid profiles;
          message = "Pi profile models must use provider/model format.";
        }
        {
          assertion = builtins.all descriptionValid profiles;
          message = "Pi profile descriptions must be non-blank and at most 512 UTF-8 bytes.";
        }
        {
          assertion = builtins.all toolsValid profiles;
          message = "Pi profile tools must be non-blank.";
        }
        {
          assertion = builtins.all instructionsValid profiles;
          message = "Pi profile instructions must be null or non-blank.";
        }
        {
          assertion = builtins.all (profile: !(profile.allowAllTools && profile.tools != [])) profiles;
          message = "Pi profiles with allowAllTools enabled must not also declare tools.";
        }
        {
          assertion = builtins.all profileFacetsKnown profiles;
          message = "Pi profile extension facets must have a registered facet owner.";
        }
        {
          assertion = builtins.all subagentTaskToolsPaired profiles;
          message = "Pi profiles must allow all tools or expose subagent_run and subagent_submit together after shared defaults and child exclusions.";
        }
      ];

      home.file."${myconfig.programs.pi-coding-agent.configDir}/agent-profiles.json".text = builtins.toJSON runtimeConfig;
    };
  }
