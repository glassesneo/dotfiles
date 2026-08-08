{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.popup";
  options = with delib;
    moduleOptions ({parent, ...}: {
      enable = readOnly (boolOption (parent.enable && builtins.elem "popup" parent.defaultExtensions));
      extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/popup.ts"]);
    });
}
