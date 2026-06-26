{
  delib,
  opencodeAgentPermissions,
  ...
}:
delib.module {
  name = "programs.opencode";

  home.ifEnabled = {myconfig, ...}: let
    inherit (opencodeAgentPermissions) agentPerm merge mergeMany perm;
    readAgentPrompt = name: builtins.readFile (./prompts + "/${name}.md");
    readSharedPrompt = name: builtins.readFile (./prompts/shared + "/${name}.md");
    renderAgentPrompt = name: replacements: let
      placeholders = builtins.attrNames replacements;
    in
      builtins.replaceStrings placeholders (map (_placeholder: replacements.${_placeholder}) placeholders) (
        readAgentPrompt name
      );

    applyCommandExecutionMode = base:
      if myconfig.programs.opencode.commandExecutionMode == "full"
      then merge base perm.execute.full
      else base;

    reviewReportFormatContract = readSharedPrompt "review-report-format";
    implementationReportFormatContract = readSharedPrompt "implementation-report-format";
    reportFilenamePolicy = readSharedPrompt "report-filename-policy";
    failureReportFormatContract = readSharedPrompt "failure-report-format";
    researchFilenamePolicy = readSharedPrompt "research-filename-policy";
  in {
    programs.opencode.settings.agent = {
      plan.disable = true;
      build.disable = true;

      taskmaster = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Source-changing implementation agent shaped by the received request or command contract.";
        prompt = renderAgentPrompt "taskmaster" {
          "{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}" = implementationReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission = applyCommandExecutionMode agentPerm.composedFull;
      };

      ultra-vibe-coding-xhigh-pro-max = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "high";
        description = "Primary agent with unrestricted external command execution plus read/write access.";
        prompt = ''
          You are the `ultra-vibe-coding-xhigh-pro-max` agent.

          You may execute external commands without OpenCode permission restrictions and may read/write files as requested.
          Follow the user's concrete request and report concisely.
        '';
        permission = applyCommandExecutionMode agentPerm.unrestrictedCommandReadWrite;
      };

      scout = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Non-source-writing agent for planning, inspection, and report workflows.";
        prompt = readAgentPrompt "scout";
        permission = applyCommandExecutionMode agentPerm.scoutFull;
      };

      review-orchestrator = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "high";
        description = "Orchestrates scaled focused code-review perspectives and dissent validation.";
        prompt = renderAgentPrompt "review_orchestrator" {
          "{{REVIEW_REPORT_FORMAT_CONTRACT}}" = reviewReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission = applyCommandExecutionMode agentPerm.reviewOrchestrator;
      };

      focused-reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Performs injected-perspective read-only code review with evidence-grounded findings.";
        prompt = readAgentPrompt "focused_reviewer";
        permission = applyCommandExecutionMode (mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
          perm.context.full
        ]);
      };

      dissent-reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Validates review outputs for misses, overreach, severity, and alternate interpretations.";
        prompt = readAgentPrompt "dissent_reviewer";
        permission = applyCommandExecutionMode (mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
          perm.context.full
        ]);
      };

      explore = {
        model = "openai/gpt-5.4-mini";
        reasoningEffort = "medium";
        description = "Read-only exploration agent for delegated repository and filesystem context gathering.";
        prompt = readAgentPrompt "explore";
        permission = applyCommandExecutionMode (mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
        ]);
      };

      plan_reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Reviews final plan steps against the referenced spec for feasibility and correctness.";
        reasoningEffort = "low";
        prompt = readAgentPrompt "plan_reviewer";
        permission = applyCommandExecutionMode (merge agentPerm.pureRead perm.context.full);
      };

      challenger = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Challenges request/spec framing and assumptions with calibrated evidence checks.";
        reasoningEffort = "medium";
        prompt = readAgentPrompt "challenger";
        permission = applyCommandExecutionMode agentPerm.challenger;
      };

      researcher = {
        mode = "subagent";
        model = "opencode/nemotron-3-ultra-free";
        reasoningEffort = "high";
        description = "Performs targeted internet research when planning workflows have material knowledge uncertainty.";
        prompt = renderAgentPrompt "researcher" {
          "{{RESEARCH_FILENAME_POLICY}}" = researchFilenamePolicy;
        };
        permission = applyCommandExecutionMode agentPerm.networkResearch;
      };

      tester = {
        mode = "subagent";
        model = "openai/gpt-5.4-mini";
        reasoningEffort = "medium";
        description = "Source-read-only validation runner that triages failures and writes failure-report files when suites fail.";
        prompt = renderAgentPrompt "tester" {
          "{{FAILURE_REPORT_FORMAT_CONTRACT}}" = failureReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission = applyCommandExecutionMode agentPerm.testRunner;
      };
    };
  };
}
