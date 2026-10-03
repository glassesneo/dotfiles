{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "assertions";
  meta.description = "Enforce module-contributed assertions across module systems.";
  options = delib.listOfOption lib.types.unspecified [];

  darwin.always = {
    inherit (myconfig) assertions;
  };
  hjem.always = {
    inherit (myconfig) assertions;
  };
})
