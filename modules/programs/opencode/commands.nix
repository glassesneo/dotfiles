{delib, ...}:
delib.module {
  name = "programs.opencode";

  home.ifEnabled = let
    readAgentPrompt = name: builtins.readFile (./prompts + "/${name}.md");
    readSharedPrompt = name: builtins.readFile (./prompts/shared + "/${name}.md");
    renderAgentPrompt = name: replacements: let
      placeholders = builtins.attrNames replacements;
    in
      builtins.replaceStrings placeholders (map (_placeholder: replacements.${_placeholder}) placeholders) (
        readAgentPrompt name
      );

    implementationReportFormatContract = readSharedPrompt "implementation-report-format";
    planFilenamePolicy = readSharedPrompt "plan-filename-policy";
    reportFilenamePolicy = readSharedPrompt "report-filename-policy";
    specCommandTemplate = builtins.readFile ./prompts/commands/spec.md;
    planCommandTemplate = builtins.readFile ./prompts/commands/plan.md;
    actCommandTemplate = renderAgentPrompt "commands/act" {
      "{{PLAN_FILENAME_POLICY}}" = planFilenamePolicy;
    };
    implCommandTemplate = renderAgentPrompt "commands/impl" {
      "{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}" = implementationReportFormatContract;
      "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
    };
  in {
    programs.opencode.settings.command = {
      spec = {
        template = specCommandTemplate;
        description = "Create and confirm a spec through the spec subagent.";
        agent = "scout";
        subtask = false;
      };
      plan = {
        template = planCommandTemplate;
        description = "Create a plan through the planner subagent.";
        agent = "scout";
        subtask = false;
      };
      sensei = {
        template = builtins.readFile ./prompts/commands/sensei.md;
        description = "Explain reports, files, commits, or git ranges with calibrated teaching.";
        agent = "scout";
        subtask = false;
      };
      idea = {
        template = builtins.readFile ./prompts/commands/idea.md;
        description = "Explore rough ideas conversationally before planning.";
        agent = "scout";
        model = "opencode/deepseek-v4-flash-free";
        subtask = false;
      };
      act = {
        template = actCommandTemplate;
        description = "Plan, approve, and implement a small task with taskmaster.";
        agent = "taskmaster";
        subtask = false;
      };
      impl = {
        template = implCommandTemplate;
        description = "Implement a plan or target with taskmaster using the implementation workflow.";
        agent = "taskmaster";
        subtask = false;
      };
    };
  };
}
