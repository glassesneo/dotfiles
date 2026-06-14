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
      agent-browser = {
        source = "${llm-agents.agent-browser}";
        subdir = "share/agent-browser/skills/agent-browser";
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      review = {
        source = ./skills/review;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      debug = {
        source = ./skills/debug;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      implement-via-cursor = {
        source = ./skills/implement-via-cursor;
        targetDirs = [
          ".agents/skills"
          ".claude/skills"
        ];
      };
      agent-reports = {
        source = ./skills/agent-reports;
        targetDirs = [
          ".agents/skills"
          ".cursor/skills"
        ];
      };
    };
  };
}
