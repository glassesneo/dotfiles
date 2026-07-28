{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.command_palette";

  options = with delib;
    moduleOptions ({parent, ...}: {
      enable = readOnly (boolOption (parent.enable && builtins.elem "command_palette" parent.defaultExtensions));
      extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/command_palette.ts"]);
    });

  home.ifEnabled = {myconfig, ...}: {
    home.file."${myconfig.programs.pi-coding-agent.configDir}/command-palette-keybindings.json".source =
      ../../extensions_src/utilities/command-palette-keybindings.json;
  };
}
