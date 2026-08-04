{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.command_palette";

  options = with delib;
    moduleOptions ({parent, ...}: {
      enable = readOnly (boolOption (parent.enable && builtins.elem "command_palette" parent.defaultExtensions));
      extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/command_palette.ts"]);
    });

  myconfig.always = {cfg, ...}: {
    programs.pi-coding-agent.keybindings.contributions.commandPalette = {
      enabled = cfg.enable;
      actions = {
        open = {
          defaultKeys = ["ctrl+shift+p"];
          contexts = ["app.global"];
          required = true;
          target = "shortcut";
        };
        moveUp = {
          role = "moveUp";
          contexts = ["commandPalette"];
          required = true;
          target = "extension";
        };
        moveDown = {
          role = "moveDown";
          contexts = ["commandPalette"];
          required = true;
          target = "extension";
        };
        collapse = {
          role = "collapse";
          contexts = ["commandPalette"];
          required = true;
          target = "extension";
        };
        expand = {
          role = "expand";
          contexts = ["commandPalette"];
          required = true;
          target = "extension";
        };
        confirm = {
          role = "confirm";
          contexts = ["commandPalette"];
          required = true;
          target = "extension";
        };
        cancel = {
          role = "cancel";
          contexts = ["commandPalette"];
          required = true;
          target = "extension";
        };
        refresh = {
          defaultKeys = [];
          contexts = ["commandPalette"];
          required = false;
          target = "extension";
        };
        stop = {
          defaultKeys = ["x"];
          contexts = ["commandPalette"];
          required = false;
          target = "extension";
        };
      };
    };
  };
}
