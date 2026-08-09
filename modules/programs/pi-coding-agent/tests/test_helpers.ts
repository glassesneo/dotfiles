import assert from "node:assert/strict";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export function extensionContext(options: {
    cwd?: string;
    mode: ExtensionContext["mode"];
    hasUI: boolean;
    ui?: Partial<ExtensionUIContext>;
}): ExtensionContext {
    const unexpected = () => {
        throw new Error("Unexpected UI call");
    };
    return {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        mode: options.mode,
        hasUI: options.hasUI,
        ui: {
            select: unexpected,
            input: unexpected,
            editor: unexpected,
            notify: unexpected,
            custom: unexpected,
            ...options.ui,
        } as ExtensionUIContext,
    } as ExtensionContext;
}

export async function yieldToIO(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

export async function eventually(predicate: () => boolean | Promise<boolean>, attempts = 1_000): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await predicate()) return;
        await yieldToIO();
    }
    assert.fail(`Condition was not met after ${attempts} event-loop turns`);
}

export async function settleWithinEventLoopTurns<T>(promise: Promise<T>, attempts = 200): Promise<T> {
    let outcome: { value: T } | { error: unknown } | undefined;
    void promise.then(value => { outcome = { value }; }, error => { outcome = { error }; });
    await eventually(() => outcome !== undefined, attempts);
    const settled = outcome;
    if (settled === undefined) assert.fail("Promise outcome was not captured");
    if ("error" in settled) throw settled.error;
    return settled.value;
}

export function textResult(content: { type: string; text?: string }): string {
    assert.equal(content.type, "text");
    assert.equal(typeof content.text, "string");
    return content.text as string;
}
