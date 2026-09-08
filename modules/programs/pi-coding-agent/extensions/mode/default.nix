{
  delib,
  lib,
  piQuestion,
  ...
}: let
  modeType = delib.submodule {
    options = with delib; {
      description = noDefault (strOption null);
      defaultProfile = noDefault (strOption null);
      tools = listOfOption str [];
      skillOptIns = listOfOption str [];
      instructions = noDefault (strOption null);
    };
  };
  judgmentContract = "Own the requester-facing outcome as orchestrator and integrator; children execute bounded units. Decide and revise the work graph from dependencies, useful concurrency, overlapping change scope, risk, and evidence needs. Choose by public capability: small for low-judgment bounded work, standard for normal repository investigation or implementation, advanced for difficult judgment across multiple invariants; use read when no source or configuration change is authorized and write when it is. Use research for repository and Web evidence and perspective for an isolated alternative view when it may change the decision. Keep overlapping writes with one owner or sequence them. Treat every child result as evidence: inspect relevant diffs, files, and validation evidence yourself; a child's done claim or test summary does not establish acceptance. Keep direct work to decomposition, user interaction, dependency resolution, integration, conflict resolution, and small integration edits where a handoff adds coordination without useful independence. Keep each handoff local: objective, scope, allowed operations, expected result, and stop condition. Stop when acceptance and residual risk can be stated. Follow the orchestration extension's mesh tool contract for asynchronous work; do not duplicate its mechanics in parent instructions.";
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
    myconfig.always.programs.pi-coding-agent.mode.modes = lib.mapAttrs (_: mode: lib.mapAttrs (_: lib.mkDefault) mode) {
      recon = {
        description = "Read-only repository investigation and collaborative dialogue.";
        defaultProfile = "sol-high";
        tools = ["read" "grep" "find" "ls" "bash" "web_fetch" "mesh_send" "mesh_get" "mesh_stop" "save_agent_artifact"] ++ lib.optional piQuestion.enabled piQuestion.tool;
        skillOptIns = ["prompt-interface-design" "agent-artifact"];
        instructions = "${judgmentContract} Use ideation-dialogue for open preference-led shaping and intent-elicitation for an already-held outcome. Use authorized capabilities for bounded investigation, research, and review units; keep parent-side repository work to orchestration and integration-owned checks. Fetch a known official URL directly; use research for discovery. Integrate evidence by claim and keep repository source and configuration unchanged.\n\nUse perspective when an isolated alternative view could materially change the design and any user-supplied A–F signal is materially present: A, multiple rational solutions exist and repository facts do not select one uniquely; B, accumulating exceptions, special cases, or abstractions question the framing; C, a costly-to-reverse architecture, responsibility boundary, state model, API, orchestration, or lifecycle decision is being made; D, a workable solution lacks a clear justification as the natural one; E, a chosen approach is stuck and you are about to switch; F, the user asks to explore alternatives or says the direction does not feel right. This is discretionary, not a checklist gate: skip it when verified facts or an explicit contract force the direction, advice cannot materially change the outcome, or the user requests direct execution without further shaping; never call it as ceremony. Every perspective handoff must include the current challenge, verified constraints, your present understanding, visible options and the discomfort with each, and an explicit request to look beyond those options for hidden premises, alternate decomposition, and a more natural abstraction or direction.";
      };
      ops = {
        description = "Direct source work and flexible orchestration.";
        defaultProfile = "sol-high";
        tools = ["read" "grep" "find" "ls" "bash" "write" "edit" "web_fetch" "mesh_send" "mesh_get" "mesh_stop" "save_agent_artifact"] ++ lib.optional piQuestion.enabled piQuestion.tool;
        skillOptIns = ["prompt-interface-design" "agent-artifact"];
        instructions = "${judgmentContract} Use authorized capabilities for bounded investigation, implementation, validation, and review units; keep parent source changes to small integration edits and conflict resolution. Fetch a known official URL directly; use research for discovery. Integrate evidence by claim and keep source changes within scope.";
      };
    };
    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      profiles = myconfig.programs.pi-coding-agent.profiles;
      unresolvedModes = lib.filterAttrs (_: mode: !(builtins.hasAttr mode.defaultProfile profiles)) cfg.modes;
      nonPiModes = lib.filterAttrs (_: mode: builtins.hasAttr mode.defaultProfile profiles && profiles.${mode.defaultProfile}.harness != "pi") cfg.modes;
    in {
      assertions = [
        {
          assertion = unresolvedModes == {};
          message = "Pi mode defaultProfile values must reference execution profiles; invalid modes: ${lib.concatStringsSep ", " (builtins.attrNames unresolvedModes)}.";
        }
        {
          assertion = nonPiModes == {};
          message = "Pi mode defaultProfile values must use the pi harness; invalid modes: ${lib.concatStringsSep ", " (builtins.attrNames nonPiModes)}.";
        }
      ];
      home.file."${myconfig.programs.pi-coding-agent.configDir}/agent-modes.json".text = builtins.toJSON {
        schemaVersion = 2;
        inherit (cfg) defaultMode modes;
      };
    };
  }
