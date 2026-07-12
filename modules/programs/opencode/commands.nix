{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.opencode";

  home.ifEnabled = let
    readCommandPrompt = name: builtins.readFile (./prompts/commands + "/${name}.md");
    workflowProfiles = {
      spec = "spec-only";
      plan = "plan-only";
      strategy = "spec-then-plan";
      act = "plan-then-implement";
      impl = "implement";
    };
    workflowDescriptions = {
      spec = "Coordinate approval-gated specification authoring.";
      plan = "Coordinate approval-gated implementation planning.";
      strategy = "Coordinate approved specification and planning stages.";
      act = "Coordinate an approved lightweight plan and implementation.";
      impl = "Coordinate authorized implementation from governing context.";
    };
    workflowCommands =
      lib.mapAttrs (name: profile: {
        template = readCommandPrompt name;
        description = workflowDescriptions.${name};
        agent = "scout";
        subtask = false;
      })
      workflowProfiles;
  in {
    assertions =
      lib.mapAttrsToList (name: profile: {
        assertion = lib.hasInfix "profile `${profile}`" workflowCommands.${name}.template;
        message = "OpenCode command `${name}` must select staged workflow profile `${profile}`.";
      })
      workflowProfiles;

    programs.opencode.settings.command =
      workflowCommands
      // {
        sensei = {
          template = readCommandPrompt "sensei";
          description = "Explain reports, files, commits, or git ranges with calibrated teaching.";
          agent = "scout";
          subtask = false;
        };
        idea = {
          template = readCommandPrompt "idea";
          description = "Explore rough ideas conversationally before planning.";
          agent = "scout";
          model = "opencode/deepseek-v4-flash-free";
          subtask = false;
        };
      };
  };
}
