{
  brewCasks,
  delib,
  host,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.claude-desktop";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.file."Applications/Claude.app".source = "${brewCasks.claude}/Applications/Claude.app";
    home.activation.disableClaudeDesktopAutoUpdate = inputs.home-manager.lib.hm.dag.entryAfter ["writeBoundary"] ''
      /usr/bin/defaults write com.anthropic.claudefordesktop disableAutoUpdates -bool true || true
    '';
  };

  # Default MCP server membership for Claude Desktop.
  myconfig.ifEnabled.programs.mcp-servers-nix.targets.claude_desktop = [
    "brave-search"
    "readability"
    "chrome-devtools"
    "context7"
  ];
}
