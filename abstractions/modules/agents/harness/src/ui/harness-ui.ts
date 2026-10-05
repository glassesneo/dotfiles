/**
 * The `HarnessUI` capability surface static contributions register against, plus
 * the screen's height allocation. It wraps the terminal-independent controllers
 * and exposes no region registration.
 */
import {
  StageController,
  type StageContentType,
  type StageHandle,
  type StageRequest,
  KeyRegistry,
  type KeyBinding,
  ItemTypeRegistry,
  type ItemFactory,
  type TimelineItemInput,
  type ItemType,
  RegionController,
  type RegionId,
  type Registration,
} from "./controllers";
import {
  EditorController,
  maxHeight,
  minHeight,
  type DraftRequestOptions,
  type DraftResult,
} from "./editor-engine";
import type { ItemScrollKind } from "./item-actions";

export interface HarnessUI<Render = unknown> {
  editor: {
    openDraft(request: DraftRequestOptions): Promise<DraftResult>;
  };
  stage: {
    registerType<T>(type: StageContentType<T, Render>): Registration;
    show<T>(request: StageRequest<T, Render>): StageHandle<T>;
  };
  timeline: {
    registerType<T>(type: ItemType<T, Render>): ItemFactory<T, Render>;
    append<T>(item: TimelineItemInput<T, Render>): void;
  };
  keys: {
    register(contribution: string, region: RegionId, bindings: readonly KeyBinding[]): Registration;
  };
  regions: {
    requestFocus(region: RegionId): boolean;
  };
}

export type ScrollKind = ItemScrollKind;

/**
 * Behaviour the default contribution drives but does not own: the screen and the
 * later timeline/stage views supply it. Keys that stay inside the region
 * model (focus moves) are handled by the contribution directly.
 */
export interface HarnessUIActions {
  submit(): void;
  cancel(): void;
  quit(): void;
  focusFromEditor(target: "timeline" | "stage"): void;
  moveTimelineCursor(delta: number): void;
  scrollTimeline(kind: ScrollKind): void;
  copyTimelineItem(): void;
  moveStageCursor(delta: number): void;
  confirmStage(): void;
  cancelStage(): void;
}

export interface HarnessControllers<Render = unknown> {
  regions: RegionController;
  keys: KeyRegistry;
  stage: StageController<Render>;
  timeline: ItemTypeRegistry<Render>;
  editor: EditorController;
}

export interface HarnessUIInstance<Render = unknown> extends HarnessUI<Render> {
  readonly controllers: HarnessControllers<Render>;
}

export interface HarnessUIOptions {
  sendPrompt?: (text: string) => Promise<boolean>;
}

export function createHarnessUI<Render = unknown>(
  options: HarnessUIOptions = {},
): HarnessUIInstance<Render> {
  const controllers = createHarnessControllers<Render>(options);
  return {
    controllers,
    editor: {
      openDraft: (request) => controllers.editor.openDraft(request),
    },
    stage: {
      registerType: (type) => controllers.stage.registerType(type),
      show: (request) => controllers.stage.show(request),
    },
    timeline: {
      registerType: (type) => controllers.timeline.registerType(type),
      append: (item) => controllers.timeline.append(item),
    },
    keys: {
      register: (contribution, region, bindings) => controllers.keys.register(contribution, region, bindings),
    },
    regions: {
      requestFocus: (region) => controllers.regions.requestFocus(region),
    },
  };
}

/**
 * Build the wired controller set: keys feed the regions, the stage controller
 * owns the `stage` region's availability, and an accepted prompt is forwarded
 * to the active stage requester.
 */
export function createHarnessControllers<Render = unknown>(
  options: { sendPrompt?: (text: string) => Promise<boolean> } = {},
): HarnessControllers<Render> {
  const keys = new KeyRegistry();
  const regions = new RegionController({ keys });
  const timeline = new ItemTypeRegistry<Render>();
  let editor: EditorController | undefined;
  const stage = new StageController<Render>({
    regions,
    // An active draft owns the editor; a stage request must not steal it back.
    canFocus: () => !editor?.activeDraft(),
  });
  editor = new EditorController({
    regions,
    sendPrompt: options.sendPrompt,
    onPromptAccepted: (text) => stage.notifyPromptSubmitted(text),
    // A shown assist keeps the stage region focusable without a request.
    onAssistChange: (hasAssist) => stage.setAssistAvailable(hasAssist),
  });
  return { regions, keys, stage, timeline, editor };
}

const maxStageHeight = 10;
const editorChromeHeight = 2;

export interface HeightAllocation {
  /** Total rows the editor occupies, including its border. */
  editor: number;
  /** Rows available to the editor body. */
  body: number;
  /** Border rows: 0 when the terminal is too short to afford them. */
  chrome: number;
  /** Rows available to the stage. */
  stage: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The editor keeps a two-row body. Stage shrinks first, then the editor border,
 * and only a terminal shorter than two rows loses the body itself.
 */
export function allocateHeights(
  terminalRows: number,
  editor: { preferredHeight: number },
  stageRequest: { preferredHeight: number },
): HeightAllocation {
  const height = Math.max(0, Math.floor(terminalRows));
  let body = clamp(Math.floor(editor.preferredHeight), minHeight, maxHeight);
  let chrome = height >= body + editorChromeHeight ? editorChromeHeight : 0;
  let stage = clamp(Math.floor(stageRequest.preferredHeight), 0, maxStageHeight);

  stage = Math.min(stage, Math.max(0, height - body - chrome));
  if (body + chrome + stage > height) {
    chrome = 0;
    stage = Math.min(stage, Math.max(0, height - body));
  }
  if (body + chrome + stage > height) {
    body = Math.max(minHeight, Math.min(body, height - chrome - stage));
  }
  if (body + chrome + stage > height) {
    chrome = 0;
    stage = 0;
    body = Math.max(0, Math.min(body, height));
  }
  return { editor: body + chrome, body, chrome, stage };
}
