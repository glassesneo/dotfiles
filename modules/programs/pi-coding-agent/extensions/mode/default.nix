{
  delib,
  lib,
  piQuestion,
  ...
}: let
  executionModule = {
    options = with delib; {
      models = noDefault (listOfOption str []);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      harness = enumOption ["pi" "cursor-agent" "codex"] "pi";
      harnessOptions = attrsOfOption lib.types.anything {};
    };
  };
  modeType = delib.submodule {
    options = with delib; {
      description = noDefault (strOption null);
      tools = listOfOption str [];
      skillOptIns = listOfOption str [];
      instructions = noDefault (strOption null);
    };
  };
  cleanExecution = execution: lib.filterAttrs (_name: value: value != null && value != {}) execution;
  judgmentContract = ''
    Own the requester's outcome as orchestrator and integrator.

    Consider delegation first; prefer it when uncertain. Use only capabilities
    authorized for this caller, choosing by task and their contracts.

    Plan and revise work from dependencies, useful concurrency, overlapping scope,
    and evidence needs. Give each child a local objective, scope, authorized actions,
    expected result, and stop condition. Keep overlapping writes with one owner or
    sequence them.

    Own user interaction, dependency resolution, evidence integration, final
    verification, and acceptance. Perform authorized work directly for integration,
    conflict resolution, or when no useful independent handoff exists. Inspect files,
    diffs, and validation evidence; a child's completion claim is evidence, not
    acceptance.

    Complete the authorized task, not merely a plan or offer to continue. Follow the
    selected dialogue method and explicit approval boundaries; do not infer execution
    authority from a request to investigate or design. Ask only for missing user
    decisions that affect the outcome, not investigable facts or settled decisions.
    Apply the selected Skill's method within task instructions and higher-priority
    constraints. If a Skill blocks or conflicts with the task, identify its file and
    relevant instruction and explain the unresolved point.

    Use the lowest responsible repository validation layer and required checks.
    Broaden or repeat checks when edits, failures, or unresolved concerns justify it.
    Finish when acceptance and residual risk are supported.

    Lead with the result in concise, plain language and enough evidence. Use lists for
    steps or parallel items. Preserve required formats, material caveats, and missing
    validation; omit repetition and generic sign-offs.
  '';
  routeContract = ''
    When implementation routing becomes useful, propose a path based on remaining
    context, handoff cost, and the value of keeping this parent as reviewer. Wait for
    the user's choice before changing mode or starting implementation; design approval
    alone is not implementation permission. Do not repeat the choice when the path is
    already specified. For a new implementation context, prepare a durable standalone
    design and use `Implement <design path>` as its initial input. Same-session work and
    leader delegation do not by themselves require a design; preserve any artifact,
    approval, or response-ending contract imposed by the request, Skill, or template.
    Treat revision within an approved scope as ordinary work, and return to dialogue
    for new scope or an unresolved user decision.
  '';
in
  delib.module {
    name = "programs.pi-coding-agent.mode";
    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "mode" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/mode.ts"]);
        defaultMode = strOption "recon";
        execution = submoduleOption executionModule {};
        modes = attrsOfOption modeType {};
      });
    myconfig.always.programs.pi-coding-agent.mode = {
      execution = lib.mapAttrs (_: lib.mkDefault) {
        models = [
          "commandcode/Qwen/Qwen3.8-27B"
          "openai-codex/gpt-5.6-sol"
        ];
        thinkingLevel = "medium";
        harness = "pi";
      };
      modes = lib.mapAttrs (_: mode: lib.mapAttrs (_: lib.mkDefault) mode) {
        recon = {
          description = "Read-only repository investigation and collaborative dialogue.";
          tools = ["read" "grep" "find" "ls" "bash" "web_fetch" "mesh_send" "mesh_get" "end_response" "mesh_control" "mesh_stop" "save_agent_artifact" "switch_mode" "session_handoff"] ++ lib.optional piQuestion.enabled piQuestion.tool;
          skillOptIns = ["prompt-interface-design" "agent-artifact"];
          instructions = ''
            ${judgmentContract}

            Investigate and develop the requested result while keeping repository source
            and configuration unchanged. Use intent-elicitation to draw out an already-held
            outcome and ideation-dialogue to shape an open preference-led direction.
            Fetch a known official URL directly; use research for source discovery.
            Integrate evidence by claim.

            Use perspective when an isolated view could materially change the design:
            multiple viable solutions remain; exceptions or abstractions question the
            framing; a costly-to-reverse boundary or lifecycle decision is being made; a
            workable approach lacks a clear justification; a stuck approach may need to
            change; or the user asks for alternatives or says the direction feels wrong.
            These are discretionary signals, not a mandatory checklist. Skip perspective
            when facts or explicit instructions settle the direction, its advice cannot
            change the outcome, or direct execution was requested without more shaping.

            Give perspective the current challenge, verified constraints, current
            understanding, visible options and concerns with each. Ask it to look beyond
            those options for hidden premises, alternate decomposition, and a more natural
            direction. Its suggestions remain evidence to assess, not repository facts.

            ${routeContract}
          '';
        };
        leader = {
          description = "Read-only parent leadership with implementation delegated to children.";
          tools = ["read" "grep" "find" "ls" "bash" "web_fetch" "mesh_send" "mesh_get" "end_response" "mesh_control" "mesh_stop" "save_agent_artifact" "switch_mode" "session_handoff"] ++ lib.optional piQuestion.enabled piQuestion.tool;
          skillOptIns = ["prompt-interface-design" "agent-artifact"];
          instructions = ''
            ${judgmentContract}

            Own investigation, planning, dialogue, review, and acceptance. Delegate every
            authorized implementation or repair to a write-capable child; return revisions
            and integration work to a child rather than editing source or configuration
            yourself. Inspect the resulting diff and validation evidence, and never accept
            work from a child's completion report alone.

            ${routeContract}
          '';
        };
        ops = {
          description = "Direct source work and flexible orchestration.";
          tools = ["read" "grep" "find" "ls" "bash" "write" "edit" "web_fetch" "mesh_send" "mesh_get" "end_response" "mesh_control" "mesh_stop" "save_agent_artifact" "switch_mode" "session_handoff"] ++ lib.optional piQuestion.enabled piQuestion.tool;
          skillOptIns = ["prompt-interface-design" "agent-artifact"];
          instructions = ''
            ${judgmentContract}

            Deliver authorized in-scope changes using bounded investigation, implementation,
            validation, and review. Fetch a known official URL directly; use research for
            source discovery. Integrate evidence by claim and keep changes within scope.

            ${routeContract}
          '';
        };
      };
    };
    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      generatedExecution = cleanExecution cfg.execution;
    in {
      assertions = [
        {
          assertion = cfg.execution.harness == "pi" && cfg.execution.thinkingLevel != null && cfg.execution.harnessOptions == {};
          message = "Pi parent execution must use the pi harness with thinkingLevel and no harnessOptions.";
        }
      ];
      home.file."${myconfig.programs.pi-coding-agent.configDir}/agent-modes.json".text = builtins.toJSON {
        schemaVersion = 4;
        inherit (cfg) defaultMode modes;
        execution = generatedExecution;
      };
    };
  }
