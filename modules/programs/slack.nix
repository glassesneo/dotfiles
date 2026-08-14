{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.slack";

  options = delib.singleEnableOption host.guiShellFeatured;

  darwin.ifEnabled = let
    plist = pkgs.formats.plist {};
    slackProfile = plist.generate "slack-no-autoupdate.mobileconfig" {
      PayloadType = "Configuration";
      PayloadVersion = 1;
      PayloadIdentifier = "local.slack.no-autoupdate";
      PayloadUUID = "23078EE5-9182-4AEC-9866-D1D81F76907D";
      PayloadDisplayName = "Disable Slack Auto Update";

      PayloadContent = [
        {
          PayloadType = "com.tinyspeck.slackmacgap";
          PayloadVersion = 1;
          PayloadIdentifier = "local.slack.no-autoupdate.preferences";
          PayloadUUID = "9475B85E-42D2-4DB5-B86C-4A7723BE55A1";
          PayloadDisplayName = "Slack Preferences";

          AutoUpdate = false;
        }
      ];
    };
  in {
    environment.etc."slack-no-autoupdate.mobileconfig".source = slackProfile;
  };

  home.ifEnabled = {
    home.packages = [
      pkgs.slack
    ];
  };
}
