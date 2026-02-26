{delib, ...}:
delib.host {
  name = "kurogane";

  darwin = {
    sops.defaultSopsFile = ../../secrets/kurogane.yaml;

    assertions = [
      {
        assertion = builtins.pathExists ../../secrets/kurogane.yaml;
        message = "Missing host secrets file: secrets/kurogane.yaml";
      }
    ];
  };
}
