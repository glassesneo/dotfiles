{delib, ...}:
delib.module {
  name = "fixture";
  meta.description = "Provide files and a package for the Hjem adapter fixture.";

  options.enable = delib.boolOption true;
  hjem.ifEnabled = {pkgs, ...}: {
    files = {
      "from-text.txt".text = "Generated from text\n";

      "from-string.json" = {
        generator = builtins.toJSON;
        value.mode = "string";
      };

      "from-derivation.json" = {
        generator =
          (pkgs.formats.json {}).generate
          "from-derivation.json";

        value.mode = "derivation";
      };

      "disabled.txt" = {
        enable = false;
        text = "excluded";
      };
    };

    packages = [
      (pkgs.writeShellScriptBin
        "fixture-tool"
        "echo fixture")
    ];
  };
}
