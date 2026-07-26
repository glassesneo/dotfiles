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
    renderText = text: replacements: let
      placeholders = builtins.attrNames replacements;
    in
      builtins.replaceStrings placeholders (map (_placeholder: replacements.${_placeholder}) placeholders) text;
    renderAgentPrompt = name: replacements: renderText (readAgentPrompt name) replacements;

    implementationPermission =
      agentPerm.implementationByPolicy.${myconfig.programs.opencode.permissionPolicy};

    designFilenamePolicy = readSharedPrompt "design-filename-policy";
    dividableTaskStructure = readSharedPrompt "task-breakdown-structure";
    researchFilenamePolicy = readSharedPrompt "research-filename-policy";
    designAuthoringContract = renderText (readSharedPrompt "design-authoring-contract") {
      "{{DIVIDABLE_TASK_STRUCTURE}}" = dividableTaskStructure;
      "{{DESIGN_FILENAME_POLICY}}" = designFilenamePolicy;
    };
  in {
    assertions = [
      {
        assertion = agentPerm.scoutFull.bash != "allow";
        message = "OpenCode workflow primary must not have unrestricted shell execution.";
      }
      {
        assertion =
          agentPerm.scoutFull."edit*"."*"
          == "deny"
          && agentPerm.scoutFull."edit*".".agents/designs/*.md" == "allow"
          && agentPerm.scoutFull."edit*".".agents/decision-records/*.md" == "allow"
          && agentPerm.scoutFull.bash."mkdir .agents/designs" == "allow"
          && agentPerm.scoutFull.bash."mkdir .agents/decision-records" == "allow"
          && !(agentPerm.scoutFull.bash ? "mkdir .agents/**");
        message = "OpenCode scout must write only canonical design and decision-record artifacts.";
      }
      {
        assertion =
          implementationPermission.task."*"
          == "deny"
          && (implementationPermission.task.explore or "deny") == "deny"
          && implementationPermission.task.tester == "allow"
          && implementationPermission.task."review-orchestrator" == "allow";
        message = "OpenCode taskmaster must self-explore while retaining validation and review delegation.";
      }
      {
        assertion = agentPerm.reviewOrchestrator.bash != "allow" && agentPerm.testRunner.bash != "allow";
        message = "OpenCode read-only reviewer/tester permissions must not serialize to unrestricted shell execution.";
      }
      {
        assertion =
          agentPerm.implementationByPolicy.normal.bash."*"
          == "ask"
          && agentPerm.implementationByPolicy."trusted-vm".bash."*" == "ask"
          && agentPerm.implementationByPolicy."trusted-vm".bash."nix *" == "allow"
          && agentPerm.implementationByPolicy."trusted-vm".bash."git?*push*" == "ask"
          && agentPerm.implementationByPolicy."trusted-vm".bash."gh *" == "ask"
          && agentPerm.implementationByPolicy."trusted-vm".bash."gh pr view*" == "allow"
          && agentPerm.implementationByPolicy."trusted-vm".bash."gh?*-X*" == "ask"
          && agentPerm.implementationByPolicy."trusted-vm".bash."nix?*;*" == "ask"
          && agentPerm.implementationByPolicy."trusted-vm".bash."gh?*;*" == "ask"
          && "*" < "nix *"
          && "gh *" < "gh pr view*"
          && "gh pr view*" < "gh?*-X*"
          && "git push*" < "git?*push*"
          && "nix *" < "nix?*;*"
          && "gh pr view*" < "gh?*;*";
        message = "OpenCode trusted policy ordering must allow local execution while keeping pushes, GitHub mutations, and ambiguous shell effects approval-gated.";
      }
      {
        assertion =
          perm.execute.safeGitInspection.bash."git diff*"
          == "allow"
          && perm.execute.safeGitInspection.bash."git?*&&*" == "deny"
          && "git diff*" < "git?*&&*";
        message = "OpenCode permission ordering must keep narrow git operator denials after broad inspection allowances.";
      }
    ];

    programs.opencode.settings.agent = {
      plan.disable = true;
      build.disable = true;

      taskmaster = {
        mode = "all";
        model = "openai/gpt-5.6-sol-fast";
        reasoningEffort = "medium";
        description = "Implementation agent that self-explores and owns approved /act designs.";
        prompt = renderAgentPrompt "taskmaster" {
          "{{DESIGN_AUTHORING_CONTRACT}}" = designAuthoringContract;
        };
        permission = implementationPermission;
      };

      ultra-vibe-coding-xhigh-pro-max = {
        disable = true;
        mode = "all";
        model = "openai/gpt-5.6-sol";
        reasoningEffort = "medium";
        description = "Primary agent with unrestricted external command execution plus read/write access.";
        prompt = ''
          You are the `ultra-vibe-coding-xhigh-pro-max` agent.

          Execute the received request using the available command and file tools. Make requested source or configuration changes, then report the outcome and any unresolved risk concisely.
        '';
        permission = agentPerm.unrestrictedCommandReadWrite;
      };

      scout = {
        mode = "all";
        model = "openai/gpt-5.6-sol-fast";
        reasoningEffort = "high";
        description = "Non-source-writing workflow agent that authors approved design artifacts.";
        prompt = renderAgentPrompt "scout" {
          "{{DESIGN_AUTHORING_CONTRACT}}" = designAuthoringContract;
        };
        permission = agentPerm.scoutFull;
      };

      review-orchestrator = {
        mode = "all";
        model = "openai/gpt-5.6-sol-fast";
        reasoningEffort = "medium";
        description = "Orchestrates scaled focused code-review perspectives and dissent validation.";
        prompt = readAgentPrompt "review_orchestrator";
        permission = agentPerm.reviewOrchestrator;
      };

      focused-reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.6-terra-fast";
        reasoningEffort = "medium";
        description = "Performs injected-perspective read-only code review with evidence-grounded findings.";
        prompt = readAgentPrompt "focused_reviewer";
        permission = mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
          perm.context.full
        ];
      };

      dissent-reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.6-terra-fast";
        reasoningEffort = "medium";
        description = "Validates review outputs for misses, overreach, severity, and alternate interpretations.";
        prompt = readAgentPrompt "dissent_reviewer";
        permission = mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
          perm.context.full
        ];
      };

      explore = {
        model = "openai/gpt-5.4-mini-fast";
        reasoningEffort = "medium";
        description = "Read-only exploration agent for delegated repository and filesystem context gathering.";
        prompt = readAgentPrompt "explore";
        permission = mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
        ];
      };

      challenger = {
        mode = "subagent";
        model = "openai/gpt-5.6-terra-fast";
        description = "Challenges request/spec framing and assumptions with calibrated evidence checks.";
        reasoningEffort = "medium";
        prompt = readAgentPrompt "challenger";
        permission = agentPerm.challenger;
      };

      researcher = {
        mode = "subagent";
        model = "openai/gpt-5.4-mini-fast";
        reasoningEffort = "high";
        description = "Performs targeted internet research when planning workflows have material knowledge uncertainty.";
        prompt = renderAgentPrompt "researcher" {
          "{{RESEARCH_FILENAME_POLICY}}" = researchFilenamePolicy;
        };
        permission = agentPerm.networkResearch;
      };

      tester = {
        mode = "subagent";
        model = "openai/gpt-5.6-luna-fast";
        reasoningEffort = "medium";
        description = "Source-read-only validation runner that triages failures and writes failure-report files when suites fail.";
        prompt = readAgentPrompt "tester";
        permission = agentPerm.testRunner;
      };
    };
  };
}
