{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.neoconf";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      neoconf = {
        enable = true;
        settings = {
          live_reload = true;
          # local_settings = ".neoconf.json";
          import.vscode = true;
        };
      };
    };
  };
}
