{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "claude-code";
  meta.description = "Provide Claude Code and configure its memory, permissions, sandbox, and updates.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {
    packages = [myconfig.agents.packages.cursor-agent];

    files.".claude/settings.json" = {
      exclusive = true;
      text = builtins.toJSON {
        "$schema" = "https://json.schemastore.org/claude-code-settings.json";
        autoMemoryEnabled = false;
        permissions.defaultMode = "auto";
        sandbox = {
          enabled = true;
          autoAllowBashIfSandboxed = true;
        };
        env = {
          DISABLE_AUTOUPDATER = "1";
          ENABLE_TOOL_SEARCH = "true";
        };
      };
    };
  };
})
