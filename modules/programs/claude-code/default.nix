{
  delib,
  inputs,
  nodePkgs,
  ...
}: let
  # Helper function to import a single skill from anthropic-skills repository
  mkSkillImport = skillName: {
    # ".claude/skills/${skillName}/SKILL.md" = {
    # source = inputs.anthropic-skills.outPath + "/${skillName}/SKILL.md";
    # };
    ".claude/skills/${skillName}" = {
      source = inputs.anthropic-skills.outPath + "/${skillName}";
    };
  };

  # List of skills to import (easily extensible)
  skillsToImport = [
    "skill-creator"
    "frontend-design"
  ];

  # Generate home.file entries for all imported skills
  importedSkills =
    builtins.foldl'
    (acc: skill: acc // mkSkillImport skill)
    {}
    skillsToImport;
in
  delib.module {
    name = "programs.claude-code";

    options = delib.singleEnableOption true;

    home.ifEnabled = {
      programs.claude-code = {
        enable = true;
        package = nodePkgs."@anthropic-ai/claude-code";
        settings = {
          env = {
            DISABLE_AUTOUPDATER = "1";
          };
        };
        memory.text = builtins.readFile ./GLOBAL_CLAUDE.md;
      };

      # Import skills from anthropic-skills repository
      home.file =
        importedSkills
        // {
          ".claude/skills/sparze".source = inputs.sparze.outPath;
        };
    };
  }
