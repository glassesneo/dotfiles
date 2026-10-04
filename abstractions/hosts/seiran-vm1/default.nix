{delib, ...}:
delib.host {
  name = "seiran-vm1";
  system = "aarch64-darwin";
  users.neo = {
    fullName = "Neo Kitani";
    email = "glassesneo@protonmail.com";
  };
  primaryUser = "neo";

  myconfig.ifEnabled = {
    shell.loginShell = "zsh";
    secrets.names = [
      "vercel-ai-gateway-api-key"
      "openrouter-api-key"
      "opencode-api-key"
      "mistral-api-key"
      "zai-api-key"
      "cohere-api-key"
      "brave-api-key"
      "brave-free-api-key"
      "parallel-api-key"
      "exa-api-key"
      "command-code-api-key"
    ];
  };

  darwin.ifEnabled = {
    system.stateVersion = 4;
    ids.gids.nixbld = 350;
  };
}
