{
  delib,
  host,
  homeConfig,
  inputs,
  pkgs,
  ...
}:
let
  kanataConfigFile = "${homeConfig.xdg.configHome}/kanata/kanata.kbd";
  kanataBarConfig = (pkgs.formats.toml {}).generate "kanata-bar.toml" {
    kanata = {
      path = "${pkgs.kanata-with-cmd}/bin/kanata";
      config = kanataConfigFile;
      port = 5829;
      extra_args = ["--nodelay"];
    };
    kanata_bar = {
      autostart_kanata = true;
      autorestart_kanata = true;
      pam_touchid = "auto";
    };
  };
  kanataBarLaunchAgent = pkgs.writeText "com.kanata-bar.launchd.plist" ''
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>KeepAlive</key>
      <dict>
        <key>SuccessfulExit</key>
        <false/>
      </dict>
      <key>Label</key>
      <string>com.kanata-bar.launchd</string>
      <key>ProcessType</key>
      <string>Interactive</string>
      <key>ProgramArguments</key>
      <array>
        <string>/Applications/Nix Apps/Kanata Bar.app/Contents/MacOS/kanata-bar</string>
        <string>--config-file</string>
        <string>${homeConfig.xdg.configHome}/kanata-bar/config.toml</string>
      </array>
      <key>RunAtLoad</key>
      <true/>
      <key>StandardErrorPath</key>
      <string>/tmp/kanata-bar.err</string>
      <key>StandardOutPath</key>
      <string>/tmp/kanata-bar.log</string>
      <key>ThrottleInterval</key>
      <integer>5</integer>
    </dict>
    </plist>
  '';
in
delib.module {
  name = "services.kanata";

  options.services.kanata = with delib; {
    enable = boolOption host.guiShellFeatured;
  };

  darwin.always = {
    imports = [
      inputs.kanata-darwin.darwinModules.default
    ];
  };

  home.ifEnabled = {
    home.activation.kanataSetup = homeConfig.lib.dag.entryAfter ["linkGeneration"] ''
      mkdir -p "${homeConfig.xdg.configHome}/kanata" "${homeConfig.xdg.configHome}/kanata-bar" "$HOME/Library/LaunchAgents"
      cp -f ${./kanata.kbd} "${kanataConfigFile}"
      cp -f ${kanataBarConfig} "${homeConfig.xdg.configHome}/kanata-bar/config.toml"
      cp -f ${kanataBarLaunchAgent} "$HOME/Library/LaunchAgents/com.kanata-bar.launchd.plist"
    '';
  };

  darwin.ifEnabled = {
    services.kanata = {
      enable = true;
      package = pkgs.kanata-with-cmd;
      configFile = kanataConfigFile;
      # With sudoers enabled, kanata starts without a login-time auth prompt.
      # Keep .kbd free of cmd actions unless you intentionally want root-triggered commands.
      sudoers = true;
      daemon.enable = false;
      kanata-bar = {
        enable = true;
        settings = {
          kanata = {
            path = "${pkgs.kanata-with-cmd}/bin/kanata";
            config = kanataConfigFile;
            port = 5829;
            extra_args = ["--nodelay"];
          };
          kanata_bar = {
            autostart_kanata = true;
            pam_touchid = "auto";
            autorestart_kanata = true;
          };
        };
      };
    };
  };
}
