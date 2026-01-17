{delib, ...}:
delib.module {
  name = "nix-darwin.system";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {myconfig, ...}: {
    system = {
      # activationScripts are executed every time you boot the system or run `nixos-rebuild` / `darwin-rebuild`.
      activationScripts.postActivation.text = ''
          # activateSettings -u will reload the settings from the database and apply them to the current session,
        # so we do not need to logout and login again to make the changes take effect.
        sudo -u ${myconfig.constants.username} /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
      '';

      defaults = {
        smb.NetBIOSName = myconfig.constants.username;

        dock = {
          autohide = true;
          autohide-delay = 1000.0;
          mouse-over-hilite-stack = true;
          orientation = "bottom";
          show-recents = false;
        };
        finder = {
          _FXShowPosixPathInTitle = true; # show full path in finder title
          AppleShowAllExtensions = true; # show all file extensions
          CreateDesktop = false;
          FXEnableExtensionChangeWarning = false; # disable warning when changing file extension
          QuitMenuItem = true; # enable quit menu item
          ShowPathbar = true; # show path bar
          ShowStatusBar = true; # show status bar
        };
        menuExtraClock = {
          IsAnalog = false;
          Show24Hour = true;
          ShowDate = 1;
          ShowDayOfMonth = true;
          ShowDayOfWeek = true;
          ShowSeconds = false;
        };
        trackpad = {
          ActuationStrength = 1;
          Clicking = false;
          Dragging = false;
          TrackpadRightClick = false;
          TrackpadThreeFingerDrag = false;
          TrackpadThreeFingerTapGesture = 0;
        };
        NSGlobalDomain = {
          # `defaults read NSGlobalDomain "xxx"`
          "com.apple.swipescrolldirection" = true; # enable natural scrolling(default to true)
          "com.apple.sound.beep.feedback" = 0; # disable beep sound when pressing volume up/down key
          "com.apple.mouse.tapBehavior" = 1;
          AppleEnableMouseSwipeNavigateWithScrolls = true;
          AppleEnableSwipeNavigateWithScrolls = true;
          AppleInterfaceStyle = "Dark"; # dark mode
          AppleKeyboardUIMode = 3; # Mode 3 enables full keyboard control.
          ApplePressAndHoldEnabled = true; # enable press and hold

          InitialKeyRepeat = 12; # normal minimum is 15 (225 ms), maximum is 120 (1800 ms)
          # sets how fast it repeats once it starts.
          KeyRepeat = 1; # normal minimum is 2 (30 ms), maximum is 120 (1800 ms)

          _HIHideMenuBar = true;

          NSAutomaticCapitalizationEnabled = false; # disable auto capitalization
          NSAutomaticDashSubstitutionEnabled = false; # disable auto dash substitution
          NSAutomaticPeriodSubstitutionEnabled = false; # disable auto period substitution
          NSAutomaticQuoteSubstitutionEnabled = false; # disable auto quote substitution
          NSAutomaticSpellingCorrectionEnabled = false; # disable auto spelling correction
          NSNavPanelExpandedStateForSaveMode = true; # expand save panel by default
          NSNavPanelExpandedStateForSaveMode2 = true;
        };
        CustomUserPreferences = {
          ".GlobalPreferences" = {
            # automatically switch to a new space when switching to the application
            AppleSpacesSwitchOnActivate = true;
          };
          NSGlobalDomain = {
            # Add a context menu item for showing the Web Inspector in web views
            WebKitDeveloperExtras = true;
          };
          "com.apple.finder" = {
            ShowExternalHardDrivesOnDesktop = true;
            ShowHardDrivesOnDesktop = true;
            ShowMountedServersOnDesktop = true;
            ShowRemovableMediaOnDesktop = true;
            _FXSortFoldersFirst = true;
            # When performing a search, search the current folder by default
            FXDefaultSearchScope = "SCcf";
          };
          "com.apple.desktopservices" = {
            # Avoid creating .DS_Store files on network or USB volumes
            DSDontWriteNetworkStores = true;
            DSDontWriteUSBStores = true;
          };
          "com.apple.spaces" = {
            "spans-displays" = 0; # Display have seperate spaces
          };
          "com.apple.WindowManager" = {
            EnableStandardClickToShowDesktop = 0; # Click wallpaper to reveal desktop
            StandardHideDesktopIcons = 0; # Show items on desktop
            HideDesktop = 0; # Do not hide items on desktop & stage manager
            StageManagerHideWidgets = 0;
            StandardHideWidgets = 0;
          };
          "com.apple.screensaver" = {
            # Require password immediately after sleep or screen saver begins
            askForPassword = 1;
            askForPasswordDelay = 0;
          };
          "com.apple.screencapture" = {
            location = "~/Desktop";
            type = "jpg";
          };
          "com.apple.AdLib" = {
            allowApplePersonalizedAdvertising = false;
          };
          # Prevent Photos from opening automatically when devices are plugged in
          "com.apple.ImageCapture".disableHotPlug = true;
        };
        loginwindow = {
          GuestEnabled = false; # disable guest user
          SHOWFULLNAME = true; # show full name in login window
        };
      };
      keyboard = {
        enableKeyMapping = true;
        remapCapsLockToControl = true;
      };
      startup.chime = false;
    };

    # Add ability to use TouchID for sudo authentication
    security.pam.services.sudo_local = {
      touchIdAuth = true;
      reattach = true;
    };
  };
}
