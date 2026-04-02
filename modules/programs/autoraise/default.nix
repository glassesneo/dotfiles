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
    home.packages = [
      pkgs.autoraise
    ];

    launchd.agents."autoraise" = {
      enable = true;
      config = {
        Label = "com.${host.name}.autoraise";
        ProgramArguments = [
          "/usr/bin/open"
          "-g"
          "-a"
          "${pkgs.autoraise}/Applications/Autoraise.app"
        ];
        RunAtLoad = true;
      };
    };
  };
}
