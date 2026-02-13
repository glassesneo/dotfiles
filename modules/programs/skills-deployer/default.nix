{
  delib,
  inputs,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.skills-deployer";

  options = delib.singleEnableOption true;

  home.always.imports = [
    inputs.skills-deployer.homeManagerModules.skills-deployer
  ];

  home.ifEnabled.programs.skills-deployer = {
    enable = true;
    defaultTargetDir = ".agents/skills";
    skills = {
      hierarchical-claude-md = {
        source = ./hierarchical-claude-md;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      ai-first-doccomments = {
        source = ./ai-first-doccomments;
      };
      tmux-runner = {
        source = ./tmux-runner;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      architecture-planning-perspective = {
        source = ./architecture-planning-perspective;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      performance-planning-perspective = {
        source = ./performance-planning-perspective;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      agent-browser = {
        source = "${llm-agents.agent-browser}";
        subdir = "etc/agent-browser/skills";
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
    };
  };
}
