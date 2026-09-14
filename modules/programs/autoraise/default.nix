{
  delib,
  host,
  pkgs,
  tccStableBinaries,
  ...
}:
delib.module {
  name = "programs.autoraise";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  myconfig.ifEnabled.system.tcc-stable-binaries.entries.autoraise = {
    source = "${pkgs.autoraise}/bin/autoraise";
    scope = "user";
  };

  home.ifEnabled = {
    home = {
      packages = [
        pkgs.autoraise
      ];
    };

    # AutoRaise interprets delay in pollMillis ticks, not seconds.
    xdg.configFile."AutoRaise/config".text = ''
      pollMillis=50
      delay=2
      requireMouseStop=true
    '';

    launchd.agents."autoraise" = {
      enable = true;
      config = {
        Label = "com.${host.name}.autoraise";
        ProgramArguments = [
          tccStableBinaries.resolved.autoraise
        ];
        RunAtLoad = true;
      };
    };
  };
}
