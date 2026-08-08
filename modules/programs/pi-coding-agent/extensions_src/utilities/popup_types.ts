import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
export type PopupComponent = Component & { dispose?(): void; requestClose?(): boolean };
export type PopupDisposition = "back" | "close-all";
export interface PopupViewContext { tui: TUI; theme: Theme; extensionContext: ExtensionContext; breadcrumb: readonly string[]; done(disposition?: PopupDisposition): void; requestRender(): void }
export interface PopupViewFactory { id: string; title: string; create(context: PopupViewContext): PopupComponent }
export const POPUP_REGISTER_EVENT = "neo.dotfiles.pi:popup-register";
export const POPUP_OPEN_EVENT = "neo.dotfiles.pi:popup-open";
export interface PopupOpenRequest { id: string; context: ExtensionContext; placement: "root" | "push"; resolve(value: PopupDisposition): void; reject(error: unknown): void }
