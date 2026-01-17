{
  delib,
  inputs,
  pkgs,
  ...
}: let
in
  delib.module {
    name = "llm-agents";

    myconfig.always.args.shared.llm-agents = inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system};
  }
