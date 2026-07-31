{
  delib,
  lib,
  ...
}: let
  moduleName = "programs.pi-coding-agent.profile";
  profileType = delib.submodule {
    options = with delib; {
      model = noDefault (strOption null);
      description = noDefault (strOption null);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      allowAllTools = boolOption false;
      tools = listOfOption str [];
      instructions = allowNull (strOption null);
      extensions = attrsOfOption attrs {};
    };
  };
  cleanProfile = profile: lib.filterAttrs (_: value: value != null) profile;
  explorerDelegationInstructions = ''
    Use the explorer subagent for bounded codebase evidence gathering after the user's objective and main issues are sufficiently clear. A bounded exploration question may be useful before or during design, before planning, during other work, or during review; when intent is still ambiguous, delegate only a narrow feasibility question. First inspect likely entrypoints or core interfaces with a small sizing pass, without turning that pass into broad exploration.

    Explore directly when the answer is likely within a few files, immediately affects the next user interaction, requires revising a design hypothesis while reading, concerns the design's central code, would lose important nuance through summarization, or is already covered by current context. Prefer explorer when the scope is broad, splits into independent directions, can be localized as a question, contains much investigation but little judgment, requires comprehensive usage or impact evidence, or can run while you make progress elsewhere. For broad design-critical questions, use a hybrid: inspect the central code yourself and verify the explorer's important evidence. Run multiple explorers in parallel only for distinct independent questions; never duplicate the same broad question.

    Set `purpose` to a short local investigation label. In `prompt`, provide one local question, why it matters, included scope and explicit exclusions, starting files or symbols when needed, allowed operations including read-only behavior, expected report content, and a stopping condition. Do not pass the whole parent task or unrelated conversation history. Verify, compress, and integrate the result yourself. You retain ownership of user intent, problem framing, overall design, final decisions, user dialogue, and task progress.
  '';
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "profile" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/profile.ts"]);
        defaultProfile = strOption "scout";
        profileCycle = listOfOption str ["scout" "taskmaster" "review-orchestrator"];
        promptRoutes = attrsOfOption str {};
        defaultTools = listOfOption str [];
        profiles = attrsOfOption profileType {};
        facetOwners = attrsOfOption str {};
      });

    myconfig.always.programs.pi-coding-agent.profile = {
      defaultTools = ["read" "grep" "find" "ls" "bash"];
      promptRoutes = {
        spec-design = "scout";
        idea-design = "scout";
        impl = "taskmaster";
        execute = "taskmaster";
        review = "review-orchestrator";
      };
      profiles = {
        full = {
          model = "openai-codex/gpt-5.6-sol";
          description = "Use for work that needs broad coding capability.";
          thinkingLevel = "medium";
          allowAllTools = true;
          tools = [];
          instructions = explorerDelegationInstructions;
          extensions = {};
        };
        taskmaster = {
          model = "openai-codex/gpt-5.6-sol";
          description = "Use for implementation against an approved design with delegated validation.";
          thinkingLevel = "medium";
          allowAllTools = false;
          tools = ["write" "edit"];
          instructions = ''
            You are the source-changing taskmaster. Follow the entrypoint-selected implementation Skill and its approved design contract. Delegate one post-change full automated validation objective to tester in one task using the implementation-validation handoff contract. When one result identifies multiple concrete implementation regressions, repair them together only when every evidence-backed fix remains within the approved design and scale contract, then revalidate the same objective in one fresh tester task. Stop on unknown cause, repeated material failure without progress, test or infrastructure ownership, or scope expansion. Do not start review unless the current entrypoint explicitly composes it.
          '';
          extensions = {};
        };
        scout = {
          model = "openai-codex/gpt-5.6-sol";
          description = "Use for read-only exploration and evidence gathering.";
          thinkingLevel = "high";
          allowAllTools = false;
          tools = [];
          instructions = explorerDelegationInstructions;
          extensions = {};
        };
        explorer = {
          model = "openai-codex/gpt-5.6-luna";
          description = "Use for source-read-only codebase exploration that returns evidence for one parent-localized question.";
          thinkingLevel = "medium";
          allowAllTools = false;
          tools = [];
          instructions = ''
            You are an explorer subagent. Load and execute codebase-exploration for the one bounded investigation handoff you receive. Gather evidence without changing source or configuration. Do not take ownership of the parent task.
          '';
          extensions = {};
        };
        tester = {
          model = "openai-codex/gpt-5.6-luna";
          description = "Use for full automated validation of an implementation without changing repository source.";
          thinkingLevel = "medium";
          allowAllTools = false;
          tools = [];
          instructions = ''
            You are a validation specialist. Load and execute implementation-validation for the full automated validation objective in the handoff. Do not change repository source or configuration. Aggregate applicable typecheck, lint, full test-suite, and design-required automated check evidence, continuing safe independent stages when an aggregate command stops early. Classify failures as regression, flaky, test bug, environment/infra, or unknown; persist every non-trivial failing run through agent-artifact as a failure report.
          '';
          extensions = {};
        };
        review-orchestrator = {
          model = "openai-codex/gpt-5.6-sol";
          description = "Use for risk-tiered read-only review with focused and dissent passes.";
          thinkingLevel = "medium";
          allowAllTools = false;
          tools = [];
          instructions = ''
            You are the read-only review orchestrator. Load and execute orchestrated-review using the explicit implementation report, its governing approved design, validation evidence, and review target. Delegate the selected focused lenses and exactly one dissent pass, then persist exactly one canonical review report. Do not change repository source or configuration and do not remediate findings.
          '';
          extensions = {};
        };
        focused-reviewer = {
          model = "openai-codex/gpt-5.6-terra";
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
          model = "openai-codex/gpt-5.6-terra";
          description = "Use once to challenge tentative review findings, severity, evidence, and uncovered perspectives from a bounded dossier.";
          thinkingLevel = "medium";
          allowAllTools = false;
          tools = [];
          instructions = ''
            Independently challenge the supplied bounded review dossier without changing source or configuration. For each disputed item, state supported, weakened, rejected, or severity-adjusted with evidence; identify material missed perspectives and remaining uncertainty. Do not repeat the full review or persist a report.
          '';
          extensions = {};
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
      modelValid = profile: builtins.match "[^/[:space:]]+/[^/[:space:]]+" profile.model != null;
      descriptionValid = profile: nonBlank profile.description && builtins.stringLength profile.description <= 512;
      toolsValid = profile:
        builtins.all nonBlank (
          if profile.allowAllTools
          then profile.tools
          else cfg.defaultTools ++ profile.tools
        );
      instructionsValid = profile: profile.instructions == null || nonBlank profile.instructions;
      serializeProfile = profile:
        cleanProfile (
          if profile.allowAllTools
          then profile
          else profile // {tools = lib.unique (cfg.defaultTools ++ profile.tools);}
        );
      runtimeConfig = {
        schemaVersion = 2;
        inherit (cfg) defaultProfile profileCycle promptRoutes;
        profiles = lib.mapAttrs (_: serializeProfile) cfg.profiles;
      };
    in {
      assertions = [
        {
          assertion = builtins.elem cfg.defaultProfile profileNames;
          message = "Pi defaultProfile must reference an existing profile.";
        }
        {
          assertion = cfg.profileCycle != [] && lib.length cfg.profileCycle == lib.length (lib.unique cfg.profileCycle) && referencesExist cfg.profileCycle;
          message = "Pi profileCycle must contain one or more unique existing profile names.";
        }
        {
          assertion = builtins.all nonBlank profileNames;
          message = "Pi agent profile names must be non-blank.";
        }
        {
          assertion = builtins.all routeCommandValid routeCommands && referencesExist routeProfiles;
          message = "Pi promptRoutes must map non-blank command tokens to existing profiles.";
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
      ];

      home.file."${myconfig.programs.pi-coding-agent.configDir}/agent-profiles.json".text = builtins.toJSON runtimeConfig;
    };
  }
