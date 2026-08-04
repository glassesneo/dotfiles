import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { isKeyRepeat, matchesKey, parseKey, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { loadFeatureKeybindings } from "./utilities/extension_keybindings.ts";

const STOP_CONFIRMATION_STATUS_KEY = "interaction-policy-stop-confirmation";
const STOP_CONFIRMATION_WINDOW_MS = 1500;

type StatusSetter = (text: string | undefined) => void;
type TimerHandle = ReturnType<typeof setTimeout> | number;
type ScheduleTimer = (callback: () => void, delay: number) => TimerHandle;
type CancelTimer = (handle: TimerHandle) => void;

export interface StopConfirmationDependencies {
    now?: () => number;
    setTimeout?: ScheduleTimer;
    clearTimeout?: CancelTimer;
}

export class StopConfirmationController {
    readonly #setStatus: StatusSetter;
    readonly #now: () => number;
    readonly #setTimeout: ScheduleTimer;
    readonly #clearTimeout: CancelTimer;
    #key: string | undefined;
    #expiresAt = 0;
    #timer: TimerHandle | undefined;
    #generation = 0;

    constructor(setStatus: StatusSetter, dependencies: StopConfirmationDependencies = {}) {
        this.#setStatus = setStatus;
        this.#now = dependencies.now ?? Date.now;
        this.#setTimeout = dependencies.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
        this.#clearTimeout = dependencies.clearTimeout ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    }

    handle(key: string, repeat: boolean, stop: () => void): void {
        if (repeat) {
            if (this.#key !== undefined && this.#now() >= this.#expiresAt) this.clear();
            return;
        }

        if (this.#key !== undefined && this.#now() < this.#expiresAt) {
            if (this.#key === key) {
                this.clear();
                stop();
            } else {
                this.start(key);
            }
            return;
        }

        this.start(key);
    }

    clear(): void {
        const hadConfirmation = this.#key !== undefined || this.#timer !== undefined;
        if (this.#timer !== undefined) this.#clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#key = undefined;
        this.#expiresAt = 0;
        this.#generation += 1;
        if (hadConfirmation) this.#setStatus(undefined);
    }

    private start(key: string): void {
        this.clear();
        this.#key = key;
        this.#expiresAt = this.#now() + STOP_CONFIRMATION_WINDOW_MS;
        this.#setStatus(`Press ${key} again to stop`);
        const generation = ++this.#generation;
        this.#timer = this.#setTimeout(() => {
            if (generation !== this.#generation) return;
            this.clear();
        }, STOP_CONFIRMATION_WINDOW_MS);
    }
}

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
    readonly #keybindings: KeybindingsManager;
    readonly #stopConfirmation: StopConfirmationController;
    #currentInterrupt: { key: string; repeat: boolean } | undefined;

    constructor(
        tui: TUI,
        theme: EditorTheme,
        keybindings: KeybindingsManager,
        context: InteractionPolicyContext,
        stopConfirmation: StopConfirmationController,
    ) {
        super(tui, theme, keybindings);
        this.#context = context;
        this.#keybindings = keybindings;
        this.#stopConfirmation = stopConfirmation;

        let forwardedOnEscape: (() => void) | undefined;
        let wrappedOnEscape: (() => void) | undefined;
        Object.defineProperty(this, "onEscape", {
            configurable: true,
            enumerable: true,
            get: () => {
                if (!forwardedOnEscape) return undefined;
                wrappedOnEscape ??= () => {
                    const interrupt = this.#currentInterrupt;
                    if (!interrupt) {
                        forwardedOnEscape?.();
                        return;
                    }
                    if (this.#context.isIdle()) {
                        this.#stopConfirmation.clear();
                        forwardedOnEscape?.();
                        return;
                    }
                    this.#stopConfirmation.handle(interrupt.key, interrupt.repeat, () => forwardedOnEscape?.());
                };
                return wrappedOnEscape;
            },
            set: (handler: (() => void) | undefined) => {
                forwardedOnEscape = handler;
                wrappedOnEscape = undefined;
            },
        });
    }

    override handleInput(data: string): void {
        if (this.#keybindings.matches(data, "app.clear")) {
            const key = parseKey(data) ?? this.#keybindings.getKeys("app.clear").find(candidate => matchesKey(data, candidate)) ?? data;
            if (this.#context.isIdle()) {
                this.#stopConfirmation.clear();
                applyCtrlCPolicy(this.#context, this);
            } else {
                this.#stopConfirmation.handle(key, isKeyRepeat(data), () => applyCtrlCPolicy(this.#context, this));
            }
            return;
        }

        const isInterrupt = this.#keybindings.matches(data, "app.interrupt");
        if (isInterrupt && !this.isShowingAutocomplete()) {
            if (this.#context.isIdle()) {
                this.#stopConfirmation.clear();
                super.handleInput(data);
                return;
            }

            this.#currentInterrupt = {
                key: parseKey(data) ?? this.#keybindings.getKeys("app.interrupt").find(key => matchesKey(data, key)) ?? data,
                repeat: isKeyRepeat(data),
            };
            try {
                super.handleInput(data);
            } finally {
                this.#currentInterrupt = undefined;
            }
            return;
        }

        this.#stopConfirmation.clear();
        super.handleInput(data);
    }
}

export function installInteractionPolicy(ctx: ExtensionContext): StopConfirmationController | undefined {
    if (ctx.mode !== "tui") return undefined;
    const stopConfirmation = new StopConfirmationController(text => ctx.ui.setStatus(STOP_CONFIRMATION_STATUS_KEY, text));
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
        new InteractionPolicyEditor(tui, theme, keybindings, ctx, stopConfirmation),
    );
    return stopConfirmation;
}

export default function interactionPolicy(pi: ExtensionAPI): void {
    loadFeatureKeybindings("interactionPolicy");
    let stopConfirmation: StopConfirmationController | undefined;
    pi.on("session_start", (_event, ctx) => {
        stopConfirmation?.clear();
        stopConfirmation = installInteractionPolicy(ctx);
    });
    pi.on("agent_settled", () => stopConfirmation?.clear());
    pi.on("session_shutdown", () => {
        stopConfirmation?.clear();
        stopConfirmation = undefined;
    });
}
