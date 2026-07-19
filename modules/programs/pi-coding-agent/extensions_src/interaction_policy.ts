import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

export interface InteractionPolicyContext {
    isIdle(): boolean;
    abort(): void;
}

export function applyCtrlCPolicy(
    context: InteractionPolicyContext,
    editor: { getExpandedText(): string; setText(value: string): void },
): void {
    if (!context.isIdle()) context.abort();
    else if (editor.getExpandedText().length > 0) editor.setText("");
}

export class InteractionPolicyEditor extends CustomEditor {
    readonly #context: InteractionPolicyContext;

    constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, context: InteractionPolicyContext) {
        super(tui, theme, keybindings);
        this.#context = context;
    }

    handleInput(data: string): void {
        if (matchesKey(data, "ctrl+c")) {
            applyCtrlCPolicy(this.#context, this);
            return;
        }
        super.handleInput(data);
    }
}

export function installInteractionPolicy(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
        new InteractionPolicyEditor(tui, theme, keybindings, ctx),
    );
}

export default function interactionPolicy(pi: ExtensionAPI): void {
    pi.on("session_start", (_event, ctx) => installInteractionPolicy(ctx));
}
