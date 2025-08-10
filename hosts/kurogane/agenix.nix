{
  delib,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}:
delib.host {
  name = "kurogane";

  home = {myconfig, ...}: {
    imports = [inputs.agenix.homeManagerModules.default];
    age = {
      identityPaths = ["/Users/${myconfig.constants.username}/.ssh/id_agenix"];
      secrets = {
        gemini-api-key.file = ../../secrets/gemini-api-key.age;
        ai-mop-api-key.file = ../../secrets/ai-mop-api-key.age;
        brave-api-key.file = ../../secrets/brave-api-key.age;
        tavily-api-key.file = ../../secrets/tavily-api-key.age;
        hf-inference-api-key.file = ../../secrets/hf-inference-api-key.age;
        iniad-id.file = ../../secrets/iniad-id.age;
        iniad-password.file = ../../secrets/iniad-password.age;
      };
    };
    home.sessionVariables = let
      cat = lib.getExe' pkgs.coreutils "cat";
    in {
      GEMINI_API_KEY = ''$(${cat} ${homeConfig.age.secrets.gemini-api-key.path})'';
      AI_MOP_API_KEY = ''$(${cat} ${homeConfig.age.secrets.ai-mop-api-key.path})'';
      TAVILY_API_KEY = ''$(${cat} ${homeConfig.age.secrets.tavily-api-key.path})'';
      HF_INFERENCE_API_KEY = ''$(${cat} ${homeConfig.age.secrets.hf-inference-api-key.path})'';
      INIAD_ID = ''$(${cat} ${homeConfig.age.secrets.iniad-id.path})'';
      INIAD_PASSWORD = ''$(${cat} ${homeConfig.age.secrets.iniad-password.path})'';
    };
  };
}
