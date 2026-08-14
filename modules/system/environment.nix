{delib, ...}:
delib.module {
  name = "system.environment";

  darwin.always.environment.variables.LC_ALL = "en_US.UTF-8";
  nixos.always.environment.variables.LC_ALL = "en_US.UTF-8";
}
