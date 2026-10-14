// app/keyboard/input-modality.ts
//
// Whether the last input was a key press or a pointer press, recorded by the key router (the owner of key listeners,
// policy P8) at document capture. A button's tooltip shows on keyboard focus (components/shared/ButtonTooltip.tsx):
// WebKit's `:focus-visible` misses focus a script moves on a key (a rail's arrows, a menu closing on Esc), so a key as
// the last input counts too. Leaving the window clears it, so focus coming back with the window is no key's.

let keyLast = false

/** The key router's keydown capture. */
export function noteKeyPress(): void {
  keyLast = true
}

/** The key router's pointerdown capture, and its window blur and page hide. */
export function notePointerPress(): void {
  keyLast = false
}

/** Whether focus arriving now follows a key press rather than a pointer press. */
export function lastInputWasKey(): boolean {
  return keyLast
}
