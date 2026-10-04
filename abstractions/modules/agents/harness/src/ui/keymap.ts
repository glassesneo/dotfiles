import type { KeyEvent } from "@opentui/core";

/**
 * Application actions reachable from the keyboard. Keys resolve to these names
 * so that other entry points, such as a command palette, can trigger the same
 * actions.
 */
export type Action = "abort" | "quit" | "scrollUp" | "scrollDown";

interface Binding {
  name: string;
  ctrl?: boolean;
  action: Action;
}

const bindings: Binding[] = [
  { name: "escape", action: "abort" },
  { name: "c", ctrl: true, action: "quit" },
  { name: "pageup", action: "scrollUp" },
  { name: "pagedown", action: "scrollDown" },
];

export function resolveAction(key: KeyEvent): Action | undefined {
  return bindings.find((binding) => binding.name === key.name && !!binding.ctrl === key.ctrl)
    ?.action;
}
