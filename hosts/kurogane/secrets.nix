{delib, ...}:
delib.host {
  name = "kurogane";

  darwin = {
    # sops.defaultSopsFile = ./secrets.yaml;

    # assertions = [
    # {
    # assertion = builtins.pathExists ./secrets.yaml;
    # message = "Missing host secrets file: hosts/kurogane/secrets.yaml";
    # }
    # ];
  };
}
