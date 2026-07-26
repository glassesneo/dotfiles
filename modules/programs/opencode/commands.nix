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
      spec-design = "design-only";
      idea-design = "design-only";
      act = "design-then-implement";
      impl = "implement";
    };
    workflowDescriptions = {
      spec-design = "Draw out requirements you already hold into one approved design.";
      idea-design = "Explore an open-ended idea and select the design elements together.";
      act = "Coordinate an approved lightweight design and implementation.";
      impl = "Coordinate authorized implementation from governing context.";
    };
    workflowAgents = {
      spec-design = "scout";
      idea-design = "scout";
      act = "taskmaster";
      impl = "taskmaster";
    };
    workflowCommands =
      lib.mapAttrs (name: profile: {
        template = readCommandPrompt name;
        description = workflowDescriptions.${name};
        agent = workflowAgents.${name};
        subtask = false;
      })
      workflowProfiles;
  in {
    assertions =
      lib.mapAttrsToList (name: profile: {
        assertion =
          lib.hasInfix "profile `${profile}`" workflowCommands.${name}.template
          && workflowCommands.${name}.agent == workflowAgents.${name};
        message = "OpenCode command `${name}` must select profile `${profile}` and start on `${workflowAgents.${name}}`.";
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
