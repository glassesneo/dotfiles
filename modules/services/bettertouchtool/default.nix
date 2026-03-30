{
  brewCasks,
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "services.bettertouchtool";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.packages = [
      brewCasks.bettertouchtool
    ];

    launchd.agents."bettertouchtool" = {
      enable = true;
      config = {
        Label = "com.${host.name}.bettertouchtool";
        ProgramArguments = [
          "/usr/bin/open"
          "-gj"
          "-a"
          # "${brewCasks.bettertouchtool}/Applications/BetterTouchTool"
          "BetterTouchTool"
        ];
        RunAtLoad = true;
      };
    };
  };
}
