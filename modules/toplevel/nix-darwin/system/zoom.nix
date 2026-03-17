{delib, ...}:
delib.module {
  name = "nix-darwin.system.zoom";

  options.nix-darwin.system.zoom = with delib; {
    enable = boolOption true;
    pipWidth = readOnly (intOption 2200);
    pipHeight = readOnly (intOption 1440);
  };

  darwin.ifEnabled = {cfg, ...}: {
    system = {
      defaults = {
        universalaccess = {
          closeViewScrollWheelToggle = true; # Enable scroll gesture with modifier keys to zoom
          closeViewZoomFollowsFocus = true; # Enable zoom to follow keyboard focus changes
        };
        CustomUserPreferences = {
          "com.apple.universalaccess" = {
            closeViewZoomMode = 1; # 1 = Picture-in-Picture
            closeViewPanningMode = 2; # Keep pointer centered while zoomed in
          };
        };
      };
      keyboard = {
        enableKeyMapping = true;
        remapCapsLockToControl = true;
      };
    };
    # system.activationScripts.zoomPipSize.text = ''
    # /usr/bin/plutil -replace closeViewWindowSize -data \
    # 'YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZlctEICVRyb290gAGkCwwTFFUkbnVsbNMNDg8QERJaTlMuc2l6ZXZhbFYkY2xhc3NaTlMuc3BlY2lhbIACgAMQAlp7NTQ0LCAzMjR90hUWFxhaJGNsYXNzbmFtZVgkY2xhc3Nlc1dOU1ZhbHVlohcZWE5TT2JqZWN0CBEaJCkyN0lMUVNYXmVwd4KEhoiTmKOstLcAAAAAAAABAQAAAAAAAAAaAAAAAAAAAAAAAAAAAAAAwA==' \
    # ~/Library/Preferences/com.apple.universalaccess.plist

    # /usr/bin/killall cfprefsd SystemUIServer >/dev/null 2>&1 || true
    # '';
    system.activationScripts.zoomPipSize.text = ''
      /usr/bin/swift -e '
        import Foundation
        import AppKit

        let size = NSSize(width: ${toString cfg.pipWidth}, height: ${toString cfg.pipHeight})
        let data = try NSKeyedArchiver.archivedData(
          withRootObject: NSValue(size: size),
          requiringSecureCoding: false
        )

        let path = NSString(string: "~/Library/Preferences/com.apple.universalaccess.plist").expandingTildeInPath
        let url = URL(fileURLWithPath: path)

        let plistData = try Data(contentsOf: url)
        var format = PropertyListSerialization.PropertyListFormat.binary
        var plist = try PropertyListSerialization.propertyList(from: plistData, options: [], format: &format) as! [String: Any]

        plist["closeViewWindowSize"] = data

        let out = try PropertyListSerialization.data(fromPropertyList: plist, format: format, options: 0)
        try out.write(to: url)
      '

      /usr/bin/killall cfprefsd SystemUIServer >/dev/null 2>&1 || true
    '';
  };
}
