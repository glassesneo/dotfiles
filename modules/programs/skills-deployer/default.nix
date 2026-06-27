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

  home.ifEnabled.programs.skills-deployer = {
    enable = true;
    defaultTargetDir = ".agents/skills";
    skills = {
      japanese-tech-writing = {
        source = "${inputs.japanese-tech-writing-skill}";
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      agent-browser = {
        source = "${llm-agents.agent-browser}";
        subdir = "share/agent-browser/skills/agent-browser";
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      agent-reports = {
        source = ./skills/agent-reports;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
          ".cursor/skills"
        ];
      };
      accessibility-ux = {
        source = ./skills/accessibility-ux;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
          ".cursor/skills"
        ];
      };
      prompt-interface-design = {
        source = ./skills/prompt-interface-design;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      skill-architect = {
        source = ./skills/skill-architect;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      refactor-maintainability = {
        source = ./skills/refactor-maintainability;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
          ".cursor/skills"
        ];
      };
    };
  };
}
