import { Match, Switch } from "solid-js";
import type { Dialog } from "./extension-ui";

/** An extension's select, confirm, or input request, drawn over the screen. */
export function DialogView(props: { dialog: Dialog }) {
  return (
    <box
      position="absolute"
      top={2}
      left={4}
      right={4}
      zIndex={10}
      border
      padding={1}
      flexDirection="column"
      backgroundColor="#1e1e2e"
    >
      <Switch>
        <Match when={props.dialog.kind === "select" && props.dialog}>
          {(dialog) => (
            <>
              <text>{dialog().title}</text>
              <select
                focused
                height={Math.min(dialog().options.length, 10)}
                showDescription={false}
                options={dialog().options.map((name) => ({ name, description: "" }))}
                onSelect={(_, option) => dialog().resolve(option?.name)}
              />
            </>
          )}
        </Match>
        <Match when={props.dialog.kind === "confirm" && props.dialog}>
          {(dialog) => (
            <>
              <text>{dialog().title}</text>
              <text>{dialog().message}</text>
              <select
                focused
                height={2}
                showDescription={false}
                options={[
                  { name: "Yes", description: "", value: true },
                  { name: "No", description: "", value: false },
                ]}
                onSelect={(_, option) => dialog().resolve(option?.value === true)}
              />
            </>
          )}
        </Match>
        <Match when={props.dialog.kind === "input" && props.dialog}>
          {(dialog) => (
            <>
              <text>{dialog().title}</text>
              <input
                focused
                placeholder={dialog().placeholder}
                // The Solid prop type also admits the core SubmitEvent.
                onSubmit={(value) => dialog().resolve(typeof value === "string" ? value : undefined)}
              />
            </>
          )}
        </Match>
      </Switch>
    </box>
  );
}
