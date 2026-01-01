{
  delib,
  inputs,
  ...
}: let
  # Helper function to import a single skill from anthropic-skills repository
  mkSkillImport = skillPath: source: {
    # ".claude/skills/${skillName}/SKILL.md" = {
    # source = inputs.anthropic-skills.outPath + "/${skillName}/SKILL.md";
    # };
    # "${skillPath}/${skillName}" = {
    # source = inputs.anthropic-skills.outPath + "/${skillName}";
    # };
    "${skillPath}" = {
      inherit source;
    };
  };

  # List of skills to import (easily extensible)
  skillsToImport = [
    "skill-creator"
    "frontend-design"
  ];

  # Generate home.file entries for all imported skills
  claudeSkills =
    builtins.foldl'
    (acc: skill: acc // mkSkillImport ".claude/skills/${skill}" (inputs.anthropic-skills.outPath + skill))
    {}
    skillsToImport;
in
  delib.module {
    name = "programs.agent-skills";

    options = delib.singleEnableOption true;

    home.ifEnabled = {
      # Import skills from anthropic-skills repository
      home.file =
        claudeSkills
        // {
          ".claude/skills/sparze".source = inputs.sparze.outPath;
        };
    };
  }
