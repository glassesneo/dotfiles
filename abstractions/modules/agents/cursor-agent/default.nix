{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "cursor-agent";
  meta.description = "Provide the Cursor Agent CLI.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {
    packages = [myconfig.agents.packages.cursor-agent];
  };
})
