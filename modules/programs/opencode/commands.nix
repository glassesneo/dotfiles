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
    planFilenamePolicy = readSharedPrompt "test-spec-filename-policy";
    dividableTaskStructure = readSharedPrompt "task-breakdown-structure";
    reportFilenamePolicy = readSharedPrompt "report-filename-policy";
    specFilenamePolicy = readSharedPrompt "spec-filename-policy";
    specCommandTemplate = builtins.replaceStrings ["{{DIVIDABLE_TASK_STRUCTURE}}" "{{SPEC_FILENAME_POLICY}}" "{{PLAN_FILENAME_POLICY}}"] [dividableTaskStructure specFilenamePolicy planFilenamePolicy] (
      builtins.readFile ./prompts/commands/spec.md
    );
    actCommandTemplate = renderAgentPrompt "commands/act" {
      "{{PLAN_FILENAME_POLICY}}" = planFilenamePolicy;
    };
    implCommandTemplate = renderAgentPrompt "commands/impl" {
      "{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}" = implementationReportFormatContract;
      "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
    };
    cursorImplCommandTemplate = renderAgentPrompt "commands/cursor-impl" {
      "{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}" = implementationReportFormatContract;
      "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
    };
  in {
    programs.opencode.settings.command = {
      spec = {
        template = specCommandTemplate;
        description = "Plan a target with scout using the specification workflow.";
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
      "cursor-impl" = {
        template = cursorImplCommandTemplate;
        description = "Implement a spec or plan through Cursor CLI, orchestrated by taskmaster.";
        agent = "taskmaster";
        subtask = false;
      };
    };
  };
}
