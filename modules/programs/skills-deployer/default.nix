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
