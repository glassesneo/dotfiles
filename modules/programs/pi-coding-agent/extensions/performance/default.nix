{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.performance";

  options = with delib;
    moduleOptions ({parent, ...}: {
      enable = readOnly (boolOption (parent.enable && builtins.elem "performance" parent.defaultExtensions));
      extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/performance.ts"]);
    });
}
