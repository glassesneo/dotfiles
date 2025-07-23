{
  config,
  pkgs,
  inputs,
  lib,
  ...
}: {
  imports = [inputs.agenix.homeManagerModules.default];

  age.identityPaths = ["/Users/neo/.ssh/id_agenix"];
  age.secrets.gemini-api-key.file = ../../secrets/gemini-api-key.age;
  age.secrets.ai-mop-api-key.file = ../../secrets/ai-mop-api-key.age;
  age.secrets.brave-api-key.file = ../../secrets/brave-api-key.age;
  age.secrets.iniad-id.file = ../../secrets/iniad-id.age;
  age.secrets.iniad-password.file = ../../secrets/iniad-password.age;

  home.sessionVariables = let
    cat = lib.getExe' pkgs.coreutils "cat";
  in {
    GEMINI_API_KEY = ''$(${cat} ${config.age.secrets.gemini-api-key.path})'';
    AI_MOP_API_KEY = ''$(${cat} ${config.age.secrets.ai-mop-api-key.path})'';
    INIAD_ID = ''$(${cat} ${config.age.secrets.iniad-id.path})'';
    INIAD_PASSWORD = ''$(${cat} ${config.age.secrets.iniad-password.path})'';
  };
}
