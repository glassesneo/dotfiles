{
  delib,
  inputs,
  nodePkgs,
  ...
}:
delib.module {
  name = "programs.codex";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    # Codex skill configuration
    programs.agent-skills = {
      enable = true;

      # Define skill sources
      sources = {
        anthropic = {
          path = inputs.anthropic-skills;
          subdir = ".";
        };
        ui-ux-pro-max = {
          path = inputs.ui-ux-pro-max;
          subdir = ".";
        };
        sparze-source = {
          path = inputs.sparze;
          subdir = ".";
        };
      };

      # Select skills for Codex
      skills = {
        enable = [
          "skill-creator"
        ];

        explicit = {
          # ui-ux-pro-max = {
          # from = "ui-ux-pro-max";
          # path = ".codex/skills/ui-ux-pro-max";
          # };
          sparze = {
            from = "sparze-source";
            path = ".";
          };
        };
      };

      # Deploy to Codex
      targets.codex = {
        dest = ".codex/skills";
        structure = "symlink-tree";
      };
    };

    programs.codex = {
      enable = true;
      package = nodePkgs."@openai/codex";
      custom-instructions = builtins.readFile ./INSTRUCTIONS.md;
      settings = {
        model_providers = {
          openrouter = {
            name = "OpenRouter";
            base_url = "https://openrouter.ai/api/v1";
            env_key = "OPENROUTER_API_KEY";
          };
          cerebras = {
            name = "Cerebras";
            base_url = "https://api.cerebras.ai/v1";
            env_key = "CEREBRAS_API_KEY";
          };
          aimop = {
            name = "AI MOP";
            base_url = "https://api.openai.iniad.org/api/v1";
            env_key = "AI_MOP_API_KEY";
          };
        };
        profile = "full-auto";
        profiles = {
          "planning" = {
            model = "gpt-5.2-codex";
            approval_policy = "untrusted";
            sandbox_mode = "read-only";
            model_reasoning_effort = "medium";
            model_reasoning_summary = "detailed";
          };
          "full-auto" = {
            model = "gpt-5.2-codex";
            approval_policy = "never";
            sandbox_mode = "workspace-write";
            network_access = true;
            model_reasoning_effort = "medium";
            # model_provider = "openrouter";
            # model = "kwaipilot/kat-coder-pro:free";
          };
        };
      };
    };
  };
}
