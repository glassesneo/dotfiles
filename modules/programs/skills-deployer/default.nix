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
      implementation-lifecycle = {
        source = ./skills/implementation-lifecycle;
        targetDirs = piAuthoringTargets;
      };
      lightweight-implementation-lifecycle = {
        source = ./skills/lightweight-implementation-lifecycle;
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
      behavioral-test-design = {
        source = ./skills/behavioral-test-design;
        targetDirs = [
          ".agents/skills"
          ".cursor/skills"
        ];
      };
    };
  in {
    assertions = [
      {
        assertion =
          builtins.pathExists ./skills/intent-elicitation/SKILL.md
          && builtins.pathExists ./skills/ideation-dialogue/SKILL.md
          && skills.intent-elicitation.targetDirs == piAuthoringTargets
          && skills.ideation-dialogue.targetDirs == piAuthoringTargets;
        message = "Pi dialogue skills must be packaged and deployed to the shared agents skill directory.";
      }
      {
        assertion =
          builtins.pathExists ./skills/codebase-exploration/SKILL.md
          && skills.codebase-exploration.targetDirs == piAuthoringTargets;
        message = "Pi codebase exploration must be packaged and deployed to the shared agents skill directory.";
      }
      {
        assertion =
          builtins.pathExists ./skills/source-implementation/SKILL.md
          && builtins.pathExists ./skills/implementation-validation/SKILL.md
          && builtins.pathExists ./skills/adaptive-review/SKILL.md
          && builtins.pathExists ./skills/implementation-lifecycle/SKILL.md
          && builtins.pathExists ./skills/lightweight-implementation-lifecycle/SKILL.md
          && skills.source-implementation.targetDirs == piAuthoringTargets
          && skills.implementation-validation.targetDirs == piAuthoringTargets
          && skills.adaptive-review.targetDirs == piAuthoringTargets
          && skills.implementation-lifecycle.targetDirs == piAuthoringTargets
          && skills.lightweight-implementation-lifecycle.targetDirs == piAuthoringTargets;
        message = "Pi implementation-assurance skills must be packaged and deployed to the shared agents skill directory.";
      }
    ];

    programs.skills-deployer = {
      enable = true;
      defaultTargetDir = ".agents/skills";
      inherit skills;
    };
  };
}
