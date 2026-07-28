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
      contract-implementation = {
        source = ./skills/contract-implementation;
        targetDirs = piAuthoringTargets;
      };
      targeted-validation = {
        source = ./skills/targeted-validation;
        targetDirs = piAuthoringTargets;
      };
      orchestrated-review = {
        source = ./skills/orchestrated-review;
        targetDirs = piAuthoringTargets;
      };
      implementation-workflow = {
        source = ./skills/implementation-workflow;
        targetDirs = piAuthoringTargets;
      };
      staged-agent-workflow = {
        source = ./skills/staged-agent-workflow;
        targetDirs = stagedWorkflowTargets;
      };
      specification-design = {
        source = ./skills/specification-design;
        targetDirs = piAuthoringTargets;
      };
      ideation-design = {
        source = ./skills/ideation-design;
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
    };
  in {
    assertions = [
      {
        assertion =
          builtins.pathExists ./skills/staged-agent-workflow/SKILL.md
          && skills.staged-agent-workflow.targetDirs == stagedWorkflowTargets;
        message = "staged-agent-workflow must be packaged and deployed to the agents and Cursor skill directories.";
      }
      {
        assertion =
          builtins.pathExists ./skills/specification-design/SKILL.md
          && builtins.pathExists ./skills/ideation-design/SKILL.md
          && skills.specification-design.targetDirs == piAuthoringTargets
          && skills.ideation-design.targetDirs == piAuthoringTargets;
        message = "Pi design skills must be packaged and deployed to the shared agents skill directory.";
      }
      {
        assertion =
          builtins.pathExists ./skills/contract-implementation/SKILL.md
          && builtins.pathExists ./skills/targeted-validation/SKILL.md
          && builtins.pathExists ./skills/orchestrated-review/SKILL.md
          && builtins.pathExists ./skills/implementation-workflow/SKILL.md
          && skills.contract-implementation.targetDirs == piAuthoringTargets
          && skills.targeted-validation.targetDirs == piAuthoringTargets
          && skills.orchestrated-review.targetDirs == piAuthoringTargets
          && skills.implementation-workflow.targetDirs == piAuthoringTargets;
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
