{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.command_palette";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {myconfig, ...}: {
    programs.pi-coding-agent.settings.extensions = [
      "${./../../extensions_src}/command_palette.ts"
    ];

    home.file."${myconfig.programs.pi-coding-agent.configDir}/command-palette-keybindings.json".source =
      ../../extensions_src/utilities/command-palette-keybindings.json;
  };
}
