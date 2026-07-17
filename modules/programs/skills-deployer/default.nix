{
  delib,
  host,
  inputs,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.skills-deployer";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.always.imports = [
    inputs.skills-deployer.homeManagerModules.skills-deployer
  ];

  home.ifEnabled = let
    stagedWorkflowTargets = [
      ".agents/skills"
      # ".claude/skills"
      ".cursor/skills"
    ];
    skills = {
      japanese-tech-writing = {
        source = "${inputs.japanese-tech-writing-skill}";
        targetDirs = [
          ".agents/skills"
          # ".claude/skills"
        ];
      };
      agent-browser = {
        source = "${llm-agents.agent-browser}";
        subdir = "share/agent-browser/skills/agent-browser";
        targetDirs = [
          ".agents/skills"
          # ".claude/skills"
        ];
      };
      agent-artifact = {
        source = ./skills/agent-artifact;
        targetDirs = [
          ".agents/skills"
          # ".claude/skills"
          ".cursor/skills"
        ];
      };
      staged-agent-workflow = {
        source = ./skills/staged-agent-workflow;
        targetDirs = stagedWorkflowTargets;
      };
      accessibility-ux = {
        source = ./skills/accessibility-ux;
        targetDirs = [
          ".agents/skills"
          # ".claude/skills"
          ".cursor/skills"
        ];
      };
      liminal-lens = {
        source = ./skills/liminal-lens;
        targetDirs = [
          ".agents/skills"
        ];
      };
      prompt-interface-design = {
        source = ./skills/prompt-interface-design;
        targetDirs = [
          ".agents/skills"
          # ".claude/skills"
        ];
      };
      skill-architect = {
        source = ./skills/skill-architect;
        targetDirs = [
          ".agents/skills"
          # ".claude/skills"
        ];
      };
      refactor-maintainability = {
        source = ./skills/refactor-maintainability;
        targetDirs = [
          ".agents/skills"
          # ".claude/skills"
          ".cursor/skills"
        ];
      };
    };
  in {
    assertions = [
      {
        assertion =
          builtins.pathExists ./skills/staged-agent-workflow/SKILL.md
          && skills.staged-agent-workflow.targetDirs == stagedWorkflowTargets;
        message = "staged-agent-workflow must be packaged and deployed to the agents and Cursor skill directories.";
      }
    ];

    programs.skills-deployer = {
      enable = true;
      defaultTargetDir = ".agents/skills";
      inherit skills;
    };
  };
}
