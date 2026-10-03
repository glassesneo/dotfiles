# Owns module responsibility descriptions; hosts are not subject to this contract.
# Every module must declare a non-blank meta.description, even when disabled.
# Force descriptions when generating modules so lazy evaluation cannot skip them.
{
  lib,
  config,
  ...
}: {
  config.settings.modules.extraSubmodules = {
    options.meta.description = lib.mkOption {
      type = lib.types.addCheck lib.types.str (value: builtins.match "[[:space:]]*" value == null);
      description = "Responsibility grouped into one concept by this module.";
    };
  };

  options.rawModules = lib.mapAttrs (_: _:
    lib.mkOption {
      apply = rawModules:
        builtins.deepSeq
        (lib.mapAttrs (_: module: module.meta.description) config.modules)
        rawModules;
    })
  config.moduleSystems;
}
