{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "claude-code";
  meta.description = "Provide Claude Code and configure its memory, permissions, sandbox, and updates.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}.claude-code];

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
}
