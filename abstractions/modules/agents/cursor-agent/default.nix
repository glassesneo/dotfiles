{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "cursor-agent";
  meta.description = "Provide the Cursor Agent CLI.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}.cursor-agent];
  };
}
