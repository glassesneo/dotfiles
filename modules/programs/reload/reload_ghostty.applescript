tell application "Ghostty"
    set t to focused terminal of selected tab of front window
    perform action "reload_config" on t
end tell
return
