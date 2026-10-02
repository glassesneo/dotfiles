{
  delib,
  lib,
  config,
  ...
}: {
  settings.modules.extraSubmodules = {name, ...}: let
    parts = lib.splitString "." name;
    parent = lib.concatStringsSep "." (lib.init parts);
    hasParent = builtins.length parts > 1 && builtins.hasAttr parent config.modules;
    participates = myoptions:
      hasParent
      && lib.hasAttrByPath (parts ++ ["enable"]) myoptions
      && lib.hasAttrByPath ((lib.splitString "." parent) ++ ["enable"]) myoptions;
  in {
    # Transform option defaults, not values: explicit overrides still reach assertions.
    options.options = lib.mkOption {
      apply = entries:
        map (entry: let
          transformed = delib.toDenixArgs ({
              myconfig,
              myoptions,
              ...
            } @ args:
              delib.processModule (declarations:
                declarations
                // lib.optionalAttrs (declarations ? enable && declarations.enable ? default) {
                  enable =
                    declarations.enable
                    // {
                      default =
                        if participates myoptions
                        then (delib.getAttrByStrPath myconfig "${parent}.enable" false) && declarations.enable.default
                        else declarations.enable.default;
                    };
                }) (delib.callIfDenixArgs entry args));
        in
          if lib.isFunction entry
          then delib.inheritFunctionArgs entry transformed
          else transformed)
        entries;
    };

    config.myconfig.always = delib.toDenixArgs ({
      myconfig,
      myoptions,
      ...
    }: {
      assertions = lib.optional (participates myoptions) {
        assertion =
          !(delib.getAttrByStrPath myconfig "${name}.enable" false)
          || delib.getAttrByStrPath myconfig "${parent}.enable" false;
        message = "${name}.enable requires ${parent}.enable = true";
      };
    });
  };
}
