{
  delib,
  host,
  homeConfig,
  inputs,
  lib,
  nickelLib,
  nodePkgs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.mcp-servers-nix";

  options.programs.mcp-servers-nix = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = let
    # Import server data from Nickel (single source of truth)
    serverData = nickelLib.importNickel "mcp-servers/main.ncl";

    # Command resolution map: command_id -> executable path
    # Nix handles all path resolution
    deno = pkgs.lib.getExe pkgs.deno;
    nodejs = pkgs.lib.getExe pkgs.nodejs;

    commands = {
      "brave-search-mcp" = pkgs.lib.getExe' nodePkgs."@brave/brave-search-mcp-server" "brave-search-mcp-server";
      "readability-mcp" = "${nodePkgs."@mizchi/readability"}/lib/node_modules/@mizchi/readability/dist/mcp.js";
      "tavily-mcp" = pkgs.lib.getExe' nodePkgs."tavily-mcp" "tavily-mcp";
      "chrome-devtools-mcp" = pkgs.lib.getExe' nodePkgs."chrome-devtools-mcp" "chrome-devtools-mcp";
      "morph-fast-apply-mcp" = pkgs.lib.getExe' nodePkgs."@morph-llm/morph-fast-apply" "mcp-server-filesystem";
      "kiri-mcp" = pkgs.lib.getExe' nodePkgs."kiri-mcp-server" "kiri-mcp-server";
      "context7-mcp" = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.context7-mcp;
      "relative-filesystem-mcp" = "${deno} run -A /Users/neo/dev/relative-filesystem-mcp/server.ts";
    };

    # Helper to get command for a server
    getCommand = server:
      if server.needs_node
      then nodejs
      else commands.${server.command_id} or server.command_id;

    # Helper to get args for a server (prepend script path for node servers)
    getArgs = server:
      if server.needs_node
      then [commands.${server.command_id}] ++ server.args
      else server.args;

    # Environment variable syntax formatters for each target
    # mcphub uses: ${env:KEY}
    mcphubEnv = key: "\${env:" + key + "}";
    # claude-code uses: ${KEY}
    claudeCodeEnv = key: "\${" + key + "}";
    # crush uses: $KEY
    crushEnv = key: "$" + key;
    # opencode uses: {env:KEY}
    opencodeEnv = key: "{env:" + key + "}";

    # Unified server config builder
    # Parameters:
    #   envFormat: function to format env var references (null = no formatting)
    #   urlType: type field value for URL servers (null = omit type)
    #   localType: type field value for local servers (null = omit type)
    #   commandAsList: whether command+args should be merged into single array
    #   envField: name of environment field ("env" or "environment")
    #   envKeysAsArray: special codex mode - env_keys become env_vars array
    mkServer = {
      envFormat ? null,
      urlType ? "sse",
      localType ? null,
      commandAsList ? false,
      envField ? "env",
      envKeysAsArray ? false,
    }: _name: server:
      if server ? url
      then
        {url = server.url;}
        // lib.optionalAttrs (urlType != null) {type = urlType;}
      else
        (
          if commandAsList
          then {command = [(getCommand server)] ++ (getArgs server);}
          else
            {command = getCommand server;}
            // lib.optionalAttrs ((getArgs server) != []) {args = getArgs server;}
        )
        // lib.optionalAttrs (localType != null) {type = localType;}
        // (
          if envKeysAsArray
          then
            # Codex special handling: static env + env_keys as array
            lib.optionalAttrs (server.env_static != {}) {env = server.env_static;}
            // lib.optionalAttrs (server.env_keys != {}) {env_vars = lib.attrValues server.env_keys;}
          else
            # Standard handling: merge formatted env_keys with static env
            lib.optionalAttrs (server.env_keys != {} || server.env_static != {}) {
              ${envField} =
                (lib.mapAttrs (_: key: envFormat key) server.env_keys)
                // server.env_static;
            }
        );

    # Target-specific builders using the unified mkServer
    mkMcphubServer = mkServer {envFormat = mcphubEnv;};
    mkClaudeCodeServer = mkServer {envFormat = claudeCodeEnv;};
    mkClaudeDesktopServer = mkClaudeCodeServer;
    mkCodexServer = mkServer {
      urlType = null;
      envKeysAsArray = true;
    };
    mkCrushServer = mkServer {envFormat = crushEnv;};
    mkOpencodeServer = mkServer {
      envFormat = opencodeEnv;
      urlType = "remote";
      localType = "local";
      commandAsList = true;
      envField = "environment";
    };

    # Filter servers by enabled list and build with the appropriate formatter
    mkServersForTarget = target: mkServerFn:
      lib.filterAttrs (name: _: builtins.elem name serverData.enabled.${target})
      (lib.mapAttrs mkServerFn serverData.servers);

    # The syntax follows https://github.com/ravitemer/mcphub.nvim/blob/main/doc/mcp/servers_json.md
    mcphub-servers = {
      programs = {
        filesystem = {
          args = ["${homeConfig.home.homeDirectory}/.dotfiles"];
          type = "stdio";
        };
        github = {
          passwordCommand = {
            GITHUB_PERSONAL_ACCESS_TOKEN = [
              (lib.getExe homeConfig.programs.gh.package)
              "auth"
              "token"
            ];
          };
          type = "stdio";
        };
        context7 = {
          enable = true;
          type = "stdio";
        };
        sequential-thinking.type = "stdio";
      };
      settings.servers = mkServersForTarget "mcphub" mkMcphubServer;
    };

    # The syntax follows https://docs.claude.com/en/docs/claude-code/mcp
    claude-code-servers = {
      programs.context7 = {
        enable = true;
        type = "stdio";
      };
      settings.servers = mkServersForTarget "claude_code" mkClaudeCodeServer;
    };

    claude-desktop-servers = {
      programs.context7 = {
        enable = true;
        type = "stdio";
      };
      settings.servers = mkServersForTarget "claude_desktop" mkClaudeDesktopServer;
    };

    codex-servers = {
      programs.context7 = {
        enable = true;
        type = "stdio";
      };
      settings.servers = mkServersForTarget "codex" mkCodexServer;
    };

    crush-servers = {
      programs.context7 = {
        enable = true;
        type = "stdio";
      };
      settings.servers = mkServersForTarget "crush" mkCrushServer;
    };

    # The syntax follows https://opencode.ai/docs/mcp-servers
    opencode-servers = {
      settings.servers = mkServersForTarget "opencode" mkOpencodeServer;
    };
  in {
    home.file = {
      "${homeConfig.xdg.configHome}/mcphub/servers.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs mcphub-servers;
      "Library/Application Support/Claude/claude_desktop_config.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs claude-desktop-servers;
    };
    programs.claude-code.mcpServers = (inputs.mcp-servers-nix.lib.evalModule pkgs claude-code-servers).config.settings.servers;
    programs.codex.settings.mcp_servers = (inputs.mcp-servers-nix.lib.evalModule pkgs codex-servers).config.settings.servers;
    programs.crush.settings.mcp = (inputs.mcp-servers-nix.lib.evalModule pkgs crush-servers).config.settings.servers;
    programs.opencode.settings.mcp = (inputs.mcp-servers-nix.lib.evalModule pkgs opencode-servers).config.settings.servers;
  };
}
