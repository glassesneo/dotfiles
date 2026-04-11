{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.autoraise";

  options = delib.singleEnableOption true;

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
          "${pkgs.autoraise}/bin/autoraise"
        ];
        RunAtLoad = true;
      };
    };
  };
}
