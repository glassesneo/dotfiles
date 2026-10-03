# Owns commit automation and its installation. Run without pre-commit's stash
# so the repository hook can reject unstaged changes before modifying anything.
{
  pkgs,
  git-hooks,
  system,
  src,
}: let
  inherit (pkgs) lib;
  runner = pkgs.writeShellApplication {
    name = "repository-hook";
    runtimeInputs = [pkgs.git pkgs.nix pkgs.nushell];
    text = ''
      exec nu --no-config-file ${./scripts}/commit.nu
    '';
  };
  hooks = git-hooks.lib.${system}.run {
    inherit src;
    install.enable = false;
    hooks.repository = {
      enable = true;
      entry = lib.getExe runner;
      pass_filenames = false;
      always_run = true;
      verbose = true;
    };
  };
  hook = pkgs.writeShellScript "pre-commit" ''
    export PATH=${lib.makeBinPath [pkgs.git]}:$PATH
    exec ${lib.getExe hooks.config.package} run --all-files --config ${hooks.config.configFile}
  '';
  directory = pkgs.runCommand "repository-git-hooks" {} ''
    mkdir -p "$out"
    ln -s ${hook} "$out/pre-commit"
  '';
in {
  inherit directory;
  shellHook = ''
    if ${pkgs.git}/bin/git rev-parse --git-dir >/dev/null 2>&1; then
      hooks_root="$(${pkgs.git}/bin/git rev-parse --path-format=absolute --git-common-dir)/nix-hooks"
      nix-store --add-root "$hooks_root" --indirect --realise ${directory} >/dev/null
      ${pkgs.git}/bin/git config --local core.hooksPath "$hooks_root"
      unset hooks_root
    fi
  '';
}
