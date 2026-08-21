{
  brewCasks,
  delib,
  homeConfig,
  host,
  pkgs,
  tiers,
  ...
}:
delib.module {
  name = "programs.discord";

  options = with delib;
    moduleOptions {
      enable = boolOption (pkgs.stdenv.isDarwin && tiers.atLeast host.tier "standard");
      package = packageOption brewCasks.discord;
    };

  home.ifEnabled = {
    programs.discord = {
      enable = true;
      package = brewCasks.discord;
    };

    # disableBreakingUpdates does not exist in the brew cask and does not interfere with the package itself, so we can use `pkgs.discord`
    home.activation.disableDiscordUpdates = homeConfig.lib.dag.entryAfter ["writeBoundary"] ''
      ${pkgs.discord.disableBreakingUpdates}/bin/disable-breaking-updates.py
    '';
  };
}
