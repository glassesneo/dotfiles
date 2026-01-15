# Skip zellij auto-start if SKIP_ZELLIJ is set (e.g., for quick edit sessions)
if [[ -z "$ZELLIJ" && -z "$SKIP_ZELLIJ" ]]; then
    zellij attach -c
fi

