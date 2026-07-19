{
  delib,
  homeConfig,
  ...
}: let
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
in
  delib.module {
    name = "programs.pi-coding-agent.command_palette";

    options = delib.singleCascadeEnableOption;

    home.ifEnabled = {
      programs.pi-coding-agent.settings.extensions = [
        "${./../../extensions_src}/command_palette.ts"
      ];

      home.file."${configDir}/command-palette-keybindings.json".source =
        ../../extensions_src/utilities/command-palette-keybindings.json;
    };
  }
