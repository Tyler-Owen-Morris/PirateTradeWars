/**
 * useInputFocus: "is the player typing?" — the one place keyboard game controls ask before acting.
 *
 * drei `KeyboardControls` (App.tsx) listens on `window`, so it sees every key even while a text box
 * has focus. Anything that turns keys into ship actions (Player.tsx, the double-tap-W auto-sail,
 * hotkeys) must call `isTextEntryActive()` and do nothing / return neutral controls when it is true.
 *
 * - `chatFocused` is set by ChatPanel while its input has focus (and cleared on blur / unmount).
 * - `isTextEntryActive()` = `chatFocused` OR the DOM focus is in any editable element (input,
 *   textarea, select, contenteditable), so other text fields (trade quantities, dialogs) count too.
 *   It is cheap (one store read + one activeElement check) and safe to call every frame.
 */
import { create } from "zustand";

interface InputFocusState {
  /** True while the global chat input has keyboard focus. */
  chatFocused: boolean;
  setChatFocused: (focused: boolean) => void;
}

export const useInputFocus = create<InputFocusState>((set) => ({
  chatFocused: false,
  setChatFocused: (focused) => set({ chatFocused: focused }),
}));

/** True when the element is a text-entry target (keys typed there must not drive the game). */
export function isEditableElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file", "image"].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** Framework-free check for game input code: is the player typing into chat or any text field? */
export function isTextEntryActive(): boolean {
  if (useInputFocus.getState().chatFocused) return true;
  return typeof document !== "undefined" && isEditableElement(document.activeElement);
}
