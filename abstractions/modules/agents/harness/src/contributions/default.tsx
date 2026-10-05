/**
 * The default key map. Every binding is registered through `HarnessUI` so the
 * screen resolves only the focused region's table.
 */
import {
  DEFAULT_REGIONS,
  type KeyBinding,
  type RegionId,
  type Registration,
} from "../ui/controllers";
import type { HarnessUI, HarnessUIActions } from "../ui/harness-ui";

export function setupDefaultUI(ui: HarnessUI, actions: HarnessUIActions): Registration[] {
  const registrations: Registration[] = [];
  const bind = (region: RegionId, bindings: readonly KeyBinding[]) => {
    registrations.push(ui.keys.register("default", region, bindings));
  };

  for (const region of DEFAULT_REGIONS) {
    bind(region, [{ actionId: `${region}.quit`, name: "c", ctrl: true, action: actions.quit }]);
  }

  bind("editor", [
    { actionId: "editor.submit-prompt", name: "return", action: actions.submit },
    { actionId: "editor.submit-prompt", name: "kpenter", action: actions.submit },
    { actionId: "editor.cancel", name: "escape", action: actions.cancel },
    { actionId: "editor.focus-timeline", name: "o", ctrl: true, action: () => actions.focusFromEditor("timeline") },
    { actionId: "editor.focus-stage", name: "k", ctrl: true, action: () => actions.focusFromEditor("stage") },
  ]);

  bind("stage", [
    { actionId: "stage.cursor-down", name: "j", action: () => actions.moveStageCursor(1) },
    { actionId: "stage.cursor-down", name: "down", action: () => actions.moveStageCursor(1) },
    { actionId: "stage.cursor-up", name: "k", action: () => actions.moveStageCursor(-1) },
    { actionId: "stage.cursor-up", name: "up", action: () => actions.moveStageCursor(-1) },
    { actionId: "stage.confirm", name: "return", action: actions.confirmStage },
    { actionId: "stage.confirm", name: "kpenter", action: actions.confirmStage },
    { actionId: "stage.cancel", name: "escape", action: actions.cancelStage },
    { actionId: "stage.focus-editor", name: "e", ctrl: true, action: () => ui.regions.requestFocus("editor") },
    { actionId: "stage.focus-timeline", name: "o", ctrl: true, action: () => ui.regions.requestFocus("timeline") },
  ]);

  bind("timeline", [
    { actionId: "timeline.cursor-down", name: "j", action: () => actions.moveTimelineCursor(1) },
    { actionId: "timeline.cursor-up", name: "k", action: () => actions.moveTimelineCursor(-1) },
    { actionId: "timeline.scroll-page-down", name: "f", ctrl: true, action: () => actions.scrollTimeline("page-down") },
    { actionId: "timeline.scroll-page-up", name: "b", ctrl: true, action: () => actions.scrollTimeline("page-up") },
    { actionId: "timeline.scroll-half-down", name: "d", ctrl: true, action: () => actions.scrollTimeline("half-down") },
    { actionId: "timeline.scroll-half-up", name: "u", ctrl: true, action: () => actions.scrollTimeline("half-up") },
    { actionId: "timeline.copy-item", name: "y", action: actions.copyTimelineItem },
    { actionId: "timeline.focus-editor", name: "e", ctrl: true, action: () => ui.regions.requestFocus("editor") },
    { actionId: "timeline.focus-stage", name: "k", ctrl: true, action: () => ui.regions.requestFocus("stage") },
  ]);

  return registrations;
}
