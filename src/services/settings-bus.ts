/**
 * Tiny indirection so any component can open the settings modal on a given
 * tab without reaching up into the app layer (components -> services is the
 * allowed direction; components -> app is not).
 *
 * The app registers the real opener once the lazy settings controller exists;
 * until then, and in embed/widget builds where the modal isn't mounted at
 * all, `openSettingsTab` is a silent no-op. Callers must therefore always
 * have a non-modal fallback for anything essential — nothing here is allowed
 * to be the only route to a feature.
 *
 * `tab` is a plain string rather than `UnifiedSettingsTabId` because that
 * union lives in the components layer; the app-side registrant casts it back.
 */

type SettingsOpener = (tab?: string) => void;

let opener: SettingsOpener | null = null;

export function registerSettingsOpener(fn: SettingsOpener): void {
  opener = fn;
}

export function openSettingsTab(tab?: string): void {
  opener?.(tab);
}
