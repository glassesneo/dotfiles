{
  pkgs,
  config,
  inputs,
  ...
}: let
  npx = pkgs.lib.getExe' pkgs.nodejs "npx";
  mcpServersConfig = inputs.mcp-servers-nix.lib.mkConfig pkgs {
    programs = {
      filesystem = {
        enable = true;
        args = [
          "${config.home.homeDirectory}/.dotfiles"
        ];
      };
      git.enable = true;
      # github = {
      # enable = true;
      # };
      fetch.enable = true;
      context7.enable = true;
      memory = {
        enable = true;
        env = {
          MCP_MEMORY_PATH = "${config.xdg.dataHome}/mcp_memory.json";
        };
      };
      sequential-thinking = {
        enable = true;
      };
      # time.enable = true;
    };
    settings.servers = {
      deepwiki = {
        url = "https://mcp.deepwiki.com/mcp";
      };
      # mcp-gemini-cli = {
      # command = "${npx}";
      # args = [
      # "@choplin/mcp-gemini-cli"
      # "--allow-npx"
      # ];
      # };
    };
  };
  mcpServers = [
    {
      home.file = {
        "${config.xdg.configHome}/mcphub/servers.json".source = mcpServersConfig;
      };
    }
  ];
in {
  imports = mcpServers;
}
