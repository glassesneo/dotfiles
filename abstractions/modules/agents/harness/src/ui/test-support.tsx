import type { Renderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { setupDefaultUI } from "../contributions/default";
import { setupStageUI } from "./stage";
import { createExtensionUI } from "./extension-ui";
import { createHarnessUI } from "./harness-ui";

export const RESIZE_SEQUENCE: readonly (readonly [number, number])[] = [[120, 40], [80, 24], [40, 12], [20, 6], [120, 2]];
export const tick = () => Bun.sleep(0);
export function count(node: Renderable, matches: (node: Renderable) => boolean): number {
  return Number(Boolean(matches(node))) + node.getChildren().reduce((sum, child) => sum + count(child, matches), 0);
}

export function fixture() {
  const ui = createHarnessUI<JSX.Element>();
  const notices: string[] = [];
  const stage = setupStageUI(ui);
  const editor = ui.controllers.editor;
  const run = (name: string) => { void ui.controllers.stage.active()?.runAction(name); };
  const registrations = setupDefaultUI(ui, {
    quit: () => {}, submit: () => { if (editor.activeDraft()) editor.submitDraft(); else void editor.submitPrompt(); },
    cancel: () => { editor.cancelDraft(); },
    focusFromEditor: (target) => editor.requestFocus(target),
    moveTimelineCursor: () => {}, scrollTimeline: () => {}, copyTimelineItem: () => {},
    moveStageCursor: (delta) => run(delta > 0 ? "next" : "previous"), confirmStage: () => run("confirm"), cancelStage: () => run("cancel"),
  });
  const extension = createExtensionUI({ ui, ...stage, notify: (_, text) => notices.push(text) });
  return { ui, stage, extension, notices, registrations, dispose: () => {
    extension.dispose(); for (const registration of registrations) registration.dispose(); stage.dispose();
  } };
}
