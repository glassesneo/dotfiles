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
    piAuthoringTargets = [
      ".agents/skills"
    ];
    skills = {
      japanese-tech-writing = {
        source = "${inputs.japanese-tech-writing-skill}";
        targetDirs = [
          ".agents/skills"
          # ".claude/skills"
        ];
      };
      cognitive-rhythm-writing = {
        source = "${inputs.cognitive-rhythm-writing-skill}";
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
      assumption-reversal = {
        source = ./skills/assumption-reversal;
        targetDirs = piAuthoringTargets;
      };
      coherent-growth = {
        source = ./skills/coherent-growth;
        targetDirs = [
          ".agents/skills"
        ];
      };
      codebase-exploration = {
        source = ./skills/codebase-exploration;
        targetDirs = piAuthoringTargets;
      };
      web-research = {
        source = ./skills/web-research;
        targetDirs = piAuthoringTargets;
      };
      source-implementation = {
        source = ./skills/source-implementation;
        targetDirs = piAuthoringTargets;
      };
      implementation-validation = {
        source = ./skills/implementation-validation;
        targetDirs = piAuthoringTargets;
      };
      adaptive-review = {
        source = ./skills/adaptive-review;
        targetDirs = piAuthoringTargets;
      };
      intent-elicitation = {
        source = ./skills/intent-elicitation;
        targetDirs = piAuthoringTargets;
      };
      ideation-dialogue = {
        source = ./skills/ideation-dialogue;
        targetDirs = piAuthoringTargets;
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
      simplify-workflow = {
        source = ./skills/simplify-workflow;
        targetDirs = piAuthoringTargets;
      };
      behavioral-test-design = {
        source = ./skills/behavioral-test-design;
        targetDirs = [
          ".agents/skills"
          ".cursor/skills"
        ];
      };
    };
  in {
    programs.skills-deployer = {
      enable = true;
      defaultTargetDir = ".agents/skills";
      inherit skills;
    };
  };
}
