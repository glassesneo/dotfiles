{
  delib,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.codex";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.codex = {
      enable = true;
      package = llm-agents.codex;
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
            model = "gpt-5.3-codex";
            approval_policy = "on-request";
            sandbox_mode = "read-only";
            model_reasoning_effort = "medium";
            model_reasoning_summary = "detailed";
          };
          "full-auto" = {
            model = "gpt-5.3-codex";
            approval_policy = "never";
            sandbox_mode = "workspace-write";
            sandbox_workspace_write.network_access = true;
            sandbox_workspace_write.writable_roots = [
              "/tmp/agent-browser"
              "/tmp/agent-browser-run"
            ];
            network_access = true;
            shell_environment_policy.experimental_use_profile = true;
            shell_environment_policy.set = {
              AGENT_BROWSER_HOME = "/tmp/agent-browser";
              PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
              XDG_RUNTIME_DIR = "/tmp/agent-browser-run";
              XDG_CACHE_HOME = "/tmp/agent-browser/cache";
              XDG_DATA_HOME = "/tmp/agent-browser/data";
              XDG_STATE_HOME = "/tmp/agent-browser/state";
            };
            model_reasoning_effort = "medium";
            # model_provider = "openrouter";
            # model = "kwaipilot/kat-coder-pro:free";
          };
          "agent-browser" = {
            model = "gpt-5.3-codex";
            approval_policy = "on-request";
            sandbox_mode = "workspace-write";
            sandbox_workspace_write.network_access = true;
            sandbox_workspace_write.writable_roots = [
              "/tmp/agent-browser"
              "/tmp/agent-browser-run"
            ];
            network_access = true;
            shell_environment_policy.experimental_use_profile = true;
            shell_environment_policy.set = {
              AGENT_BROWSER_HOME = "/tmp/agent-browser";
              PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
              XDG_RUNTIME_DIR = "/tmp/agent-browser-run";
              XDG_CACHE_HOME = "/tmp/agent-browser/cache";
              XDG_DATA_HOME = "/tmp/agent-browser/data";
              XDG_STATE_HOME = "/tmp/agent-browser/state";
            };
            model_reasoning_effort = "medium";
          };
        };
      };
    };
  };
}
