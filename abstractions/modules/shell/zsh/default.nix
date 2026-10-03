{
  delib,
  lib,
  mylib,
  ...
}:
delib.module {
  name = "zsh";
  meta.description = "Enable Zsh and provide the foundation required for its use.";

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption true;
      package = packageOption pkgs.zsh;
    };

  hjem.always.options.zsh.zshenv = mylib.fragments.option;

  hjem.ifEnabled = {config, ...}: {
    files.".zshenv" = {
      exclusive = true;
      text = mylib.fragments.render config.zsh.zshenv;
    };
  };

  darwin.ifEnabled = {config, ...}: {
    # explicitly disable nix-darwin default
    programs.zsh.enable = lib.mkDefault false;

    environment = {
      etc = {
        "zshenv".text = ''
          if [[ -o rcs && -z "''${__NIX_DARWIN_SET_ENVIRONMENT_DONE-}" ]]; then
            . ${config.system.build.setEnvironment}
          fi
        '';
        "zshrc" = {
          text = '''';
          knownSha256Hashes = [
            "19a2d673ffd47b8bed71c5218ff6617dfc5e8533b240b9ba79142a45f8823c23"
            "fb5827cb4712b7e7932d438067ec4852c8955a9ff0f55e282473684623ebdfa1" # macOS
            "4d1ab5704f9d167a042fecac0d056c8a79a8ebd71e032d3489536c8db9ffe3e0" # macOS 26b1 and later
            "c5a00c072c920f46216454978c44df044b2ec6d03409dc492c7bdcd92c94a110" # official installer
            "40b0d8751adae5b0100a4f863be5b75613a49f62706427e92604f7e04d2e2261" # official installer
            "bf76c5ed8e65e616f4329eccf662ee91be33b8bfd33713ce9946f2fe94fea7fa" # official installer（macOS 26b1 and later）
            "2af1b563e389d11b76a651b446e858116d7a20370d9120a7e9f78991f3e5f336" # Determinate installer
            "27274e44b88a1174787f9a3d437d3387edc4f9aaaf40356054130797f5dc7912" # Determinate installer（macOS 26b1 and later）
          ];
        };
        "zprofile" = {
          text = '''';
          knownSha256Hashes = [
            "db8422f92d8cff684e418f2dcffbb98c10fe544b5e8cd588b2009c7fa89559c5"
            "0235d3c1b6cf21e7043fbc98e239ee4bc648048aafaf6be1a94a576300584ef2" # macOS
            "f320016e2cf13573731fbee34f9fe97ba867dd2a31f24893d3120154e9306e92" # macOS 26b1 and later
          ];
        };
      };
    };
  };
}
