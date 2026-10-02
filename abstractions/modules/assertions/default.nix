{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "assertions";
  options = delib.listOfOption lib.types.unspecified [];

  darwin.always = {
    inherit (myconfig) assertions;
  };
  hjem.always = {
    inherit (myconfig) assertions;
  };
})
