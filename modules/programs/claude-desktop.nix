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
}
