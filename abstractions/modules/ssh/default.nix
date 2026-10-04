{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "ssh";
  meta.description = "Configure the OpenSSH client and the user's main identity.";

  options = with delib; {
    enable = boolOption true;
    mainIdentity = readOnly (strOption "~/.ssh/id_ed25519_personal");
  };

  hjem.ifEnabled = {pkgs, ...}: {
    files.".ssh/config" = {
      exclusive = true;
      text =
        ''
          Host github.com
            HostName github.com
            User git
            IdentityFile ${cfg.mainIdentity}

          Host *
            AddKeysToAgent yes
            IdentitiesOnly yes
        ''
        + lib.optionalString pkgs.stdenv.hostPlatform.isDarwin "  UseKeychain yes\n";
    };
  };
})
