import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { POPUP_OPEN_EVENT, POPUP_REGISTER_EVENT, type PopupComponent, type PopupDisposition, type PopupOpenRequest, type PopupViewFactory } from "./utilities/popup_types.ts";

type PopupViewEntry = { factory: PopupViewFactory; component?: PopupComponent & Partial<Focusable>; settle: (value: PopupDisposition) => void; disposed: boolean };

export class PopupStack implements Component, Focusable {
    readonly #tui: TUI; readonly #theme: Theme; readonly #ctx: ExtensionContext; readonly #factories: ReadonlyMap<string, PopupViewFactory>; readonly #finish: (value: PopupDisposition) => void;
    #views: PopupViewEntry[] = []; #focused = false; #closed = false;
    constructor(tui: TUI, theme: Theme, ctx: ExtensionContext, factories: ReadonlyMap<string, PopupViewFactory>, finish: (value: PopupDisposition) => void) { this.#tui = tui; this.#theme = theme; this.#ctx = ctx; this.#factories = factories; this.#finish = finish; }
    get focused() { return this.#focused; } set focused(value: boolean) { this.#focused = value; const current = this.#views.at(-1)?.component; if (current && "focused" in current) current.focused = value; }
    open(id: string): Promise<PopupDisposition> { const factory = this.#factories.get(id); if (!factory) return Promise.reject(new Error(`Unknown popup view: ${id}`)); return new Promise(resolve => { let pending: PopupDisposition | undefined; const entry: PopupViewEntry = { factory, settle: resolve, disposed: false }; const done = (disposition: PopupDisposition = "back") => { if (!entry.component) { pending ??= disposition; return; } this.#settle(entry, disposition); }; const component = factory.create({ tui: this.#tui, theme: this.#theme, extensionContext: this.#ctx, breadcrumb: [...this.#views.map(view => view.factory.title), factory.title], done, requestRender: () => this.#tui.requestRender() }) as PopupComponent & Partial<Focusable>; entry.component = component; this.#views.push(entry); if (pending) { this.#settle(entry, pending); return; } const parent = this.#views.at(-2)?.component; if (parent && "focused" in parent) parent.focused = false; if ("focused" in component) component.focused = this.#focused; this.#tui.requestRender(); }); }
    #dispose(view: PopupViewEntry): void { if (view.disposed) return; view.disposed = true; const component = view.component; if (!component) return; if ("focused" in component) component.focused = false; component.dispose?.(); }
    #settle(origin: PopupViewEntry, disposition: PopupDisposition) {
        if (this.#closed || origin.disposed || this.#views.at(-1) !== origin) return;
        if (disposition === "close-all") {
            this.#closed = true;
            for (const view of this.#views.splice(0).reverse()) { this.#dispose(view); view.settle("close-all"); }
            this.#finish("close-all");
            return;
        }
        const current = this.#views.pop(); if (!current) return; this.#dispose(current); current.settle("back");
        if (this.#views.length === 0) { this.#closed = true; this.#finish("back"); return; }
        const parent = this.#views.at(-1)?.component; if (parent && "focused" in parent) parent.focused = this.#focused; this.#tui.requestRender();
    }
    render(width: number): string[] { return this.#views.at(-1)?.component?.render(width) ?? []; }
    invalidate(): void { this.#views.at(-1)?.component?.invalidate?.(); }
    handleInput(data: string): void {
        const current = this.#views.at(-1)?.component;
        if (!current) return;
        if (matchesKey(data, Key.escape)) {
            if (current.requestClose?.() === false) return;
            const entry = this.#views.at(-1);
            if (entry) this.#settle(entry, "back");
            return;
        }
        current.handleInput?.(data);
    }
}

export function registerPopupHost(pi: ExtensionAPI): void {
    const factories = new Map<string, PopupViewFactory>(); let active: PopupStack | undefined; let opening = false;
    pi.events.on(POPUP_REGISTER_EVENT, value => { const factory = value as PopupViewFactory; if (!factory?.id || typeof factory.create !== "function") return; factories.set(factory.id, factory); });
    pi.events.on(POPUP_OPEN_EVENT, value => { const request = value as PopupOpenRequest; void (async () => { try { if (!factories.has(request.id)) throw new Error(`Unknown popup view: ${request.id}`); if (request.placement === "push" && active) { request.resolve(await active.open(request.id)); return; } if (opening) throw new Error("A popup root is already opening"); if (request.context.mode !== "tui") throw new Error("Popup views require TUI mode"); opening = true; const result = await request.context.ui.custom<PopupDisposition>((tui, theme, _keys, done) => { active = new PopupStack(tui, theme, request.context, factories, done); void active.open(request.id); return active; }, { overlay: true, overlayOptions: { anchor: "center", width: "70%", minWidth: 60, maxHeight: "80%", margin: 1 } }); request.resolve(result ?? "back"); } catch (error) { request.reject(error); } finally { active = undefined; opening = false; } })(); });
}
export function providePopupView(pi: ExtensionAPI, factory: PopupViewFactory): void { pi.events.emit(POPUP_REGISTER_EVENT, factory); }
export function openPopupView(pi: ExtensionAPI, id: string, context: ExtensionContext, placement: "root" | "push" = "root"): Promise<PopupDisposition> { return new Promise((resolve, reject) => pi.events.emit(POPUP_OPEN_EVENT, { id, context, placement, resolve, reject } satisfies PopupOpenRequest)); }
export default registerPopupHost;
