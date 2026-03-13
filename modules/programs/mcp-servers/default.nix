{
  delib,
  host,
  inputs,
  lib,
  nodePackages,
  nodePkgs,
  pkgs,
  sopsSecretPaths,
  ...
}:
delib.module {
  name = "programs.mcp-servers-nix";

  options.programs.mcp-servers-nix = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = let
    # Nix-native server data (migrated from nickel/mcp-servers/servers.ncl)
    servers = {
      brave-search = {
        command_id = "brave-search-mcp";
        args = [];
        env_keys = {BRAVE_API_KEY = "BRAVE_API_KEY";};
        env_static = {};
        needs_node = false;
      };
      deepwiki = {
        url = "https://mcp.deepwiki.com/mcp";
        args = [];
        env_keys = {};
        env_static = {};
        needs_node = false;
      };
      readability = {
        command_id = "readability-mcp";
        args = [];
        env_keys = {};
        env_static = {};
        needs_node = true;
      };
      tavily = {
        command_id = "tavily-mcp";
        args = [];
        env_keys = {TAVILY_API_KEY = "TAVILY_API_KEY";};
        env_static = {};
        needs_node = false;
      };
      chrome-devtools = {
        command_id = "chrome-devtools-mcp";
        args = [];
        env_keys = {};
        env_static = {};
        needs_node = false;
      };
      morph-fast-apply = {
        command_id = "morph-fast-apply-mcp";
        args = [];
        env_keys = {MORPH_API_KEY = "MORPH_API_KEY";};
        env_static = {ALL_TOOLS = "false";};
        needs_node = false;
      };
      kiri = {
        command_id = "kiri-mcp";
        args = ["--repo" "." "--db" ".kiri/index.duckdb" "--watch"];
        env_keys = {};
        env_static = {};
        needs_node = false;
      };
      codex = {
        command_id = "codex-mcp";
        args = ["mcp-server"];
        env_keys = {};
        env_static = {};
        needs_node = false;
      };
      context7 = {
        command_id = "context7-mcp";
        args = [];
        env_keys = {};
        env_static = {};
        needs_node = false;
      };
      # web-search-prime = {
      #   url = "https://api.z.ai/api/mcp/web_search_prime/mcp";
      #   url_type = "http";
      #   auth_secret = "zai-api-key";
      # };
      # web-reader = {
      #   url = "https://api.z.ai/api/mcp/web_reader/mcp";
      #   url_type = "http";
      #   auth_secret = "zai-api-key";
      # };
      # zread = {
      #   url = "https://api.z.ai/api/mcp/zread/mcp";
      #   url_type = "http";
      #   auth_secret = "zai-api-key";
      # };
    };

    # Which servers are enabled per target (migrated from nickel/mcp-servers/servers.ncl)
    enabled = {
      claude_code = [
        "brave-search"
        "deepwiki"
        "readability"
        "morph-fast-apply"
        "kiri"
        "codex"
        "context7"
      ];
      claude_desktop = [
        "brave-search"
        "readability"
        "chrome-devtools"
        "context7"
      ];
      codex = [
        "brave-search"
        "deepwiki"
        "readability"
        "chrome-devtools"
        "morph-fast-apply"
        "kiri"
        "context7"
      ];
      opencode = [
        "brave-search"
        "deepwiki"
        "readability"
        "kiri"
        "context7"
      ];
    };

    # Target adapter metadata (migrated from nickel/mcp-servers/targets.ncl)
    claudeMeta = {
      env_syntax_mode = "dollar_braces";
      env_field_name = "env";
      static_env_field_name = "env";
      url_type_policy = "sse";
      local_type_policy = null;
      command_list_behavior = false;
    };

    targetsMeta = {
      claude_code = claudeMeta;
      claude_desktop = claudeMeta;
      codex = {
        env_syntax_mode = "raw";
        env_field_name = "env_vars";
        static_env_field_name = "env";
        url_type_policy = null;
        local_type_policy = null;
        command_list_behavior = false;
      };
      opencode = {
        env_syntax_mode = "braces_env_colon";
        env_field_name = "environment";
        static_env_field_name = "environment";
        url_type_policy = "remote";
        local_type_policy = "local";
        command_list_behavior = true;
      };
    };

    # Nix assertions replacing nickel/mcp-servers/schema.ncl + validate.ncl
    requiredTargets = ["claude_code" "claude_desktop" "codex" "opencode"];
    serverNames = builtins.attrNames servers;

    serverValidationAssertions = lib.flatten [
      # Each server must define exactly one of url or command_id
      (lib.mapAttrsToList (name: server: {
          assertion = (server ? url) != (server ? command_id);
          message = "MCP server `${name}` must define exactly one of `url` or `command_id` (found ${
            if (server ? url) && (server ? command_id)
            then "both"
            else "neither"
          }).";
        })
        servers)

      # All required targets must be present in enabled
      (map (target: {
          assertion = builtins.hasAttr target enabled;
          message = "MCP enabled is missing required target key `${target}`.";
        })
        requiredTargets)

      # Enabled server references must point to known servers
      (lib.flatten (map (target:
        lib.optional (builtins.hasAttr target enabled) (
          map (serverName: {
            assertion = builtins.elem serverName serverNames;
            message = "MCP enabled.${target} references unknown server `${serverName}`.";
          })
          enabled.${target}
        ))
      requiredTargets))

      # needs_node = true requires command_id
      (lib.flatten (lib.mapAttrsToList (name: server:
        lib.optional (server.needs_node or false) {
          assertion = server ? command_id;
          message = "MCP server `${name}` has needs_node = true but does not define `command_id`.";
        })
      servers))
    ];

    # Command resolution map: command_id -> executable path
    # Nix handles all path resolution
    nodejs = pkgs.lib.getExe pkgs.nodejs;
    cat = pkgs.lib.getExe' pkgs.coreutils "cat";

    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";

    wrappers = {
      brave-search-mcp = pkgs.writeShellScriptBin "brave-search-mcp-server-wrapped" ''
        secret_file="${secretPath "brave-api-key"}"
        if [ ! -r "$secret_file" ]; then
          echo "Missing readable secret file: $secret_file" >&2
          exit 1
        fi

        export BRAVE_API_KEY="$(${cat} "$secret_file")"
        exec "${nodePackages}/bin/brave-search-mcp-server" "$@"
      '';

      tavily-mcp = pkgs.writeShellScriptBin "tavily-mcp-wrapped" ''
        secret_file="${secretPath "tavily-api-key"}"
        if [ ! -r "$secret_file" ]; then
          echo "Missing readable secret file: $secret_file" >&2
          exit 1
        fi

        export TAVILY_API_KEY="$(${cat} "$secret_file")"
        exec "${nodePackages}/bin/tavily-mcp" "$@"
      '';

      morph-fast-apply-mcp = pkgs.writeShellScriptBin "morph-fast-apply-mcp-wrapped" ''
        secret_file="${secretPath "morph-fast-apply-api-key"}"
        if [ ! -r "$secret_file" ]; then
          echo "Missing readable secret file: $secret_file" >&2
          exit 1
        fi

        export MORPH_API_KEY="$(${cat} "$secret_file")"
        exec "${nodePackages}/bin/mcp-server-filesystem" "$@"
      '';
    };

    wrapperManagedCommandIds = builtins.attrNames wrappers;

    commands = {
      "brave-search-mcp" = lib.getExe wrappers."brave-search-mcp";
      "readability-mcp" = "${nodePackages}/lib/node_modules/@mizchi/readability/dist/mcp.js";
      "tavily-mcp" = lib.getExe wrappers."tavily-mcp";
      "chrome-devtools-mcp" = "${nodePackages}/bin/chrome-devtools-mcp";
      "morph-fast-apply-mcp" = lib.getExe wrappers."morph-fast-apply-mcp";
      "kiri-mcp" = pkgs.lib.getExe' nodePkgs."kiri-mcp-server" "kiri-mcp-server";
      "context7-mcp" = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.context7-mcp;
    };

    withWrapperManagedEnv = server:
      if builtins.elem (server.command_id or "") wrapperManagedCommandIds
      then server // {env_keys = {};}
      else server;

    # Command token resolved from commands map, fallback to command_id token
    resolveCommandToken = server: commands.${server.command_id} or server.command_id or "";

    # Helper to get command for a server
    getCommand = server:
      if server.needs_node
      then nodejs
      else resolveCommandToken server;

    # Helper to get args for a server (prepend script path for node servers)
    getArgs = server:
      if server.needs_node
      then [(resolveCommandToken server)] ++ server.args
      else server.args;

    commandBasedServers = lib.filterAttrs (_: server: server ? command_id) servers;

    commandAssertions = lib.flatten (
      lib.mapAttrsToList (
        name: server: let
          resolvedToken = resolveCommandToken server;
          hasCommandMapping = builtins.hasAttr server.command_id commands;
        in
          [
            {
              assertion = builtins.stringLength resolvedToken > 0;
              message = "MCP server `${name}` command invariant failed: command_id `${server.command_id}` resolved to an empty command token.";
            }
          ]
          ++ lib.optional server.needs_node {
            assertion = hasCommandMapping;
            message = "MCP server `${name}` needs_node invariant failed: command_id `${server.command_id}` is missing from config.programs.mcp-servers.commands.";
          }
      )
      commandBasedServers
    );

    envFormatters = {
      dollar_env_colon = key: "\${env:" + key + "}";
      dollar_braces = key: "\${" + key + "}";
      dollar_bare = key: "$" + key;
      braces_env_colon = key: "{env:" + key + "}";
      raw = key: key;
    };

    formatEnvValue = mode: key: let
      formatter = envFormatters.${mode} or null;
    in
      if formatter == null
      then throw "Unsupported MCP env_syntax_mode `${mode}`"
      else formatter key;

    mkEnvFields = targetMeta: server: let
      dynamicFieldName = targetMeta.env_field_name;
      staticFieldName = targetMeta.static_env_field_name;

      dynamicFields =
        if server.env_keys == {}
        then {}
        else if dynamicFieldName == "env_vars"
        then {${dynamicFieldName} = lib.attrValues server.env_keys;}
        else {
          ${dynamicFieldName} = lib.mapAttrs (_: key: formatEnvValue targetMeta.env_syntax_mode key) server.env_keys;
        };

      staticFields =
        if server.env_static == {}
        then {}
        else {${staticFieldName} = server.env_static;};
    in
      if dynamicFields == {}
      then staticFields
      else if staticFields == {}
      then dynamicFields
      else if dynamicFieldName == staticFieldName
      then {
        ${dynamicFieldName} = dynamicFields.${dynamicFieldName} // staticFields.${staticFieldName};
      }
      else dynamicFields // staticFields;

    # Target-aware auth header rendering for remote servers with auth_secret.
    # Claude Code uses ${VAR} env interpolation; OpenCode uses {file:path} substitution.
    mkAuthHeaders = target: server:
      if !(server ? auth_secret)
      then {}
      else let
        secret = server.auth_secret;
        envVarName = lib.toUpper (builtins.replaceStrings ["-"] ["_"] secret);
        bearerValue =
          if target == "claude_code" || target == "claude_desktop"
          then "Bearer \${${envVarName}}"
          else if target == "opencode"
          then "Bearer {file:${secretPath secret}}"
          else "Bearer {env:${envVarName}}";
      in {
        headers.Authorization = bearerValue;
      };

    mkServer = targetMeta: target: _name: server: let
      urlTypePolicy = targetMeta.url_type_policy;
      localTypePolicy = targetMeta.local_type_policy;
      # Per-server url_type override for Claude targets only (e.g. "http" for streamable HTTP);
      # non-Claude targets keep their target default (e.g. OpenCode uses "remote").
      isClaude = target == "claude_code" || target == "claude_desktop";
      effectiveUrlType =
        if isClaude && (server ? url_type)
        then server.url_type
        else urlTypePolicy;
    in
      if server ? url
      then
        {url = server.url;}
        // lib.optionalAttrs (effectiveUrlType != null) {type = effectiveUrlType;}
        // mkAuthHeaders target server
      else
        (
          if targetMeta.command_list_behavior
          then {command = [(getCommand server)] ++ (getArgs server);}
          else
            {command = getCommand server;}
            // lib.optionalAttrs ((getArgs server) != []) {args = getArgs server;}
        )
        // lib.optionalAttrs (localTypePolicy != null) {type = localTypePolicy;}
        // mkEnvFields targetMeta server;

    mkServersForTarget = target: let
      targetMeta = targetsMeta.${target};
    in
      lib.filterAttrs (name: _: builtins.elem name enabled.${target})
      (lib.mapAttrs (name: server: mkServer targetMeta target name (withWrapperManagedEnv server)) servers);

    # Targets that require the context7 side-effect
    # See https://docs.claude.com/en/docs/claude-code/mcp and https://opencode.ai/docs/mcp-servers
    context7Targets = ["claude_code" "claude_desktop" "codex"];

    mkTargetConfig = target:
      lib.optionalAttrs (builtins.elem target context7Targets) {
        programs.context7 = {
          enable = true;
          type = "stdio";
        };
      }
      // {settings.servers = mkServersForTarget target;};

    claude-code-servers = mkTargetConfig "claude_code";
    claude-desktop-servers = mkTargetConfig "claude_desktop";
    codex-servers = mkTargetConfig "codex";
    opencode-servers = mkTargetConfig "opencode";
  in {
    assertions = commandAssertions ++ serverValidationAssertions;
    home.file = {
      # "${homeConfig.xdg.configHome}/mcphub/servers.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs mcphub-servers;
      "Library/Application Support/Claude/claude_desktop_config.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs claude-desktop-servers;
    };
    programs.claude-code.mcpServers = (inputs.mcp-servers-nix.lib.evalModule pkgs claude-code-servers).config.settings.servers;
    programs.codex.settings.mcp_servers = (inputs.mcp-servers-nix.lib.evalModule pkgs codex-servers).config.settings.servers;
    programs.opencode.settings.mcp = (inputs.mcp-servers-nix.lib.evalModule pkgs opencode-servers).config.settings.servers;
  };
}
