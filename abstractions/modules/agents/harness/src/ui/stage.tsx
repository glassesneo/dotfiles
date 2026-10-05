import type { JSX } from "@opentui/solid";
import { For } from "solid-js";
import type { StageContentType, StageHandle } from "./controllers";
import type { HarnessUIInstance } from "./harness-ui";
import { useVersion } from "./state";

export interface ChoiceValue {
  title: string;
  message?: string;
  choices: readonly string[];
  cursor: number;
  result?: string;
  busy?: boolean;
  onChoose?(choice: string, handle: StageHandle<ChoiceValue>): void | Promise<void>;
}

export function StageView(props: { ui: HarnessUIInstance<JSX.Element> }) {
  const version = useVersion(props.ui.controllers.stage, props.ui.controllers.regions);
  const ids = () => { version(); const active = props.ui.controllers.stage.active(); return active ? [active.id] : []; };
  return <For each={ids()}>{() => props.ui.controllers.stage.active()?.render(version)}</For>;
}

/**
 * The shared choice content: a titled list with next/previous/confirm/cancel
 * actions. `kind` is the caller's registration name, so a contribution can
 * reuse the renderer and actions without colliding with `choice`/`confirm`.
 */
export function createChoiceType(kind: string): StageContentType<ChoiceValue, JSX.Element> {
  return {
    kind,
    defaultValue: { title: "", choices: [], cursor: 0 },
    render: (props) => (
      <box height="100%" flexDirection="column" backgroundColor="#1e1e2e">
        <text height={1} flexShrink={0}>{`${props.focused ? "▶ " : ""}stage: ${props.value.title}`}</text>
        {props.value.message ? <text flexShrink={0}>{props.value.message}</text> : null}
        <select
          flexGrow={1}
          showDescription={false}
          showSelectionIndicator
          options={props.value.choices.map((name) => ({ name, description: "" }))}
          selectedIndex={props.value.cursor}
        />
      </box>
    ),
    actions: {
      next: ({ value, handle }) => handle.update({ ...value, cursor: Math.min(value.choices.length - 1, value.cursor + 1) }),
      previous: ({ value, handle }) => handle.update({ ...value, cursor: Math.max(0, value.cursor - 1) }),
      confirm: async ({ value, handle }) => {
        const choice = value.choices[value.cursor];
        if (choice === undefined || value.busy) return;
        if (!value.onChoose) { handle.close({ ...value, result: choice }); return; }
        handle.update({ ...value, busy: true });
        try { await value.onChoose(choice, handle); }
        finally { handle.update({ ...handle.value(), busy: false }); }
      },
      cancel: ({ handle }) => handle.cancel(),
    },
  };
}

export function setupStageUI(ui: HarnessUIInstance<JSX.Element>) {
  const choiceType = createChoiceType("choice");
  const confirmType = createChoiceType("confirm");
  const registrations = [ui.stage.registerType(choiceType), ui.stage.registerType(confirmType)];
  return {
    choiceType,
    confirmType,
    dispose: () => { for (const registration of registrations) registration.dispose(); },
  };
}
