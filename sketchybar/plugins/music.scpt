#! /usr/bin/osascript
tell application "Arc"
    tell front window
        set youtubeTabs to title of every tab whose URL contains "music.youtube.com"
        if (count of youtubeTabs) > 0 then
            return item 1 of youtubeTabs
        end if
    end tell
end tell
