/**
 * Verification contribution: a short choice request on the stage opens one
 * destination draft per item and appends an `example-result` item on submit.
 * Cancelling a draft keeps the request open so the item can be retried.
 */
import type { JSX } from "@opentui/solid";
import { createChoiceType, type ChoiceValue } from "../ui/stage";
import type { Registration, StageHandle } from "../ui/controllers";
import type { HarnessUI } from "../ui/harness-ui";

interface ExampleResultValue {
  item: string;
  note: string;
}

const exampleResultSourceText = (value: ExampleResultValue): string =>
  `${value.item}\n${value.note}`;

const ITEMS: readonly string[] = ["Alpha", "Beta", "Gamma"];

export interface ChoiceDraftExample extends Registration {
  open(): void;
}

export function setupChoiceDraftExample(ui: HarnessUI<JSX.Element>): ChoiceDraftExample {
  const resultType = ui.timeline.registerType<ExampleResultValue>({
    kind: "example-result",
    render: ({ value }) => (
      <box flexDirection="column">
        <text fg="#89b4fa">{`example: ${value.item}`}</text>
        <text>{value.note}</text>
      </box>
    ),
    sourceText: exampleResultSourceText,
    actions: {},
  });
  const choiceType = createChoiceType("example-choice");
  const choiceRegistration = ui.stage.registerType(choiceType);
  let active: StageHandle<ChoiceValue> | undefined;

  const choose = async (item: string, request: StageHandle<ChoiceValue>): Promise<void> => {
    const abort = new AbortController();
    void request.closed.then(() => abort.abort());
    const draft = await ui.editor.openDraft({
      destination: `choice-draft-example:${item}`,
      label: `note: ${item}`,
      requester: "stage",
      signal: abort.signal,
    });
    if (draft.status === "cancelled" || active !== request) return;
    ui.timeline.append(resultType.create({ item, note: draft.text }));
    request.close({ ...request.value(), result: item });
  };

  const open = (): void => {
    if (active) {
      ui.regions.requestFocus("stage");
      return;
    }
    const handle = ui.stage.show({
      requester: "example",
      type: choiceType,
      value: {
        title: "Pick an item",
        choices: ITEMS,
        cursor: 0,
        onChoose: choose,
      },
      preferredHeight: ITEMS.length + 2,
    });
    active = handle;
    void handle.closed.then(() => {
      if (active === handle) active = undefined;
    });
  };

  return {
    open,
    dispose: () => {
      active?.cancel();
      active = undefined;
      choiceRegistration.dispose();
      resultType.dispose();
    },
  };
}
