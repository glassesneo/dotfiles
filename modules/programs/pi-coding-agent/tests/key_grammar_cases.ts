export const validKeyIds = [
    "a", "0", "ctrl+a", "shift+ctrl+f12", "alt+pageUp", "escape", "return",
    "space", "clear", "pageDown", "left", "f1", "f12", "`", "_", "shift+?",
] as const;

export const invalidKeyIds = [
    "", "+", "ctrl+", "+a", "ctrl+ctrl+a", "meta+a", "CTRL+a", "A", "f0", "f13",
    "pageup", "not-a-key", "ctrl+shift",
] as const;
