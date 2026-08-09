{
  delib,
  lib,
  ...
}: let
  modeType = delib.submodule {
    options = with delib; {
      model = noDefault (strOption null);
      description = noDefault (strOption null);
      thinkingLevel = enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] "medium";
      allowAllTools = boolOption false;
      tools = listOfOption str [];
      skillOptIns = listOfOption str [];
      instructions = noDefault (strOption null);
    };
  };
in
  delib.module {
    name = "programs.pi-coding-agent.mode";
    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "mode" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/mode.ts"]);
        defaultMode = strOption "recon";
        modes = attrsOfOption modeType {};
      });
    myconfig.always.programs.pi-coding-agent.mode.modes = {
      recon = {
        model = "openai-codex/gpt-5.6-sol";
        description = "Read-only repository investigation and collaborative dialogue.";
        thinkingLevel = "high";
        tools = ["read" "grep" "find" "ls" "bash" "web_search" "web_fetch" "mesh_run" "mesh_submit" "mesh_get" "mesh_wait" "mesh_stop" "mesh_route" "save_agent_artifact"];
        skillOptIns = ["task-orchestration" "agent-artifact"];
        instructions = "Use ideation-dialogue for open preference-led shaping and intent-elicitation when the user already holds the intended outcome. Investigate evidence directly or delegate separable exploration/review. For independent source-backed Web concerns, consider bounded Codex delegation early and run separable concerns in parallel. Fetch a single known official URL directly. Integrate delegated evidence claim by claim, using normal retrieval to resolve gaps or disagreement; do not mutate repository source.";
      };
      ops = {
        model = "openai-codex/gpt-5.6-sol";
        description = "Direct source work and flexible orchestration.";
        thinkingLevel = "high";
        allowAllTools = true;
        skillOptIns = ["task-orchestration" "agent-artifact"];
        instructions = "Complete the user's objective. Apply task-orchestration when work is genuinely separable. For independent source-backed Web concerns, consider bounded Codex delegation early and run separable concerns in parallel. Fetch a single known official URL directly. Integrate delegated evidence claim by claim, using normal retrieval to resolve gaps or disagreement, and do not stop merely because an optional workflow artifact is absent.";
      };
    };
    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      names = builtins.attrNames cfg.modes;
      nonBlank = value: builtins.isString value && builtins.match ".*[^[:space:]].*" value != null;
      knownTools = ["read" "grep" "find" "ls" "bash" "write" "edit" "question" "web_search" "web_fetch" "mesh_enable" "mesh_run" "mesh_submit" "mesh_get" "mesh_wait" "mesh_stop" "mesh_route" "save_agent_artifact"];
      knownSkills = ["task-orchestration" "agent-artifact" "web-research"];
      valid = mode: nonBlank mode.model && builtins.match "[^/[:space:]]+/[^/[:space:]]+" mode.model != null && nonBlank mode.description && nonBlank mode.instructions && lib.length mode.tools == lib.length (lib.unique mode.tools) && builtins.all (tool: builtins.elem tool knownTools) mode.tools && lib.length mode.skillOptIns == lib.length (lib.unique mode.skillOptIns) && builtins.all (skill: builtins.elem skill knownSkills) mode.skillOptIns && (!mode.allowAllTools || mode.tools == []);
    in {
      assertions = [
        {
          assertion = builtins.elem cfg.defaultMode names && builtins.all valid (builtins.attrValues cfg.modes);
          message = "Pi modes must be valid and defaultMode must exist.";
        }
      ];
      home.file."${myconfig.programs.pi-coding-agent.configDir}/agent-modes.json".text = builtins.toJSON {
        schemaVersion = 1;
        inherit (cfg) defaultMode modes;
      };
    };
  }
