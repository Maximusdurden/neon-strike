// Keybind manager: central registry of all actions, their default keys,
// localStorage persistence, and conflict detection.

// Default bindings. Each action maps to a KeyboardEvent.code (or 'Mouse0'/'Mouse2').
export const DEFAULT_KEYBINDS = {
  moveForward: 'KeyW',
  moveBack: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  jump: 'Space',
  reload: 'KeyR',
  tag: 'KeyE',
  interact: 'KeyF',
  shove: 'KeyV',
  leanLeft: 'KeyQ',
  leanRight: 'KeyE',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  weapon3: 'Digit3',
  weapon4: 'Digit4',
  weapon5: 'Digit5',
  weapon6: 'Digit6',
  pause: 'Escape',
  fire: 'Mouse0',
  zoom: 'Mouse2',
};

// Friendly display names for actions (shown in the keybinds screen).
export const ACTION_NAMES = {
  moveForward: 'Move Forward',
  moveBack: 'Move Back',
  moveLeft: 'Move Left',
  moveRight: 'Move Right',
  sprint: 'Sprint',
  crouch: 'Crouch',
  jump: 'Jump',
  reload: 'Reload',
  tag: 'Tag / Mark Suspect',
  interact: 'Interact (Fuse / Car / Trash)',
  shove: 'Shove / Tackle',
  leanLeft: 'Lean Left',
  leanRight: 'Lean Right',
  weapon1: 'Weapon Slot 1',
  weapon2: 'Weapon Slot 2',
  weapon3: 'Weapon Slot 3',
  weapon4: 'Weapon Slot 4',
  weapon5: 'Weapon Slot 5',
  weapon6: 'Weapon Slot 6',
  pause: 'Pause',
  fire: 'Fire',
  zoom: 'Zoom (Scope)',
};

const STORAGE_KEY = 'neonstrike_keybinds';

// Convert a KeyboardEvent.code / mouse button to a friendly label.
export function keyLabel(code) {
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  if (!code) return '—';
  const map = {
    Space: 'SPACE',
    ShiftLeft: 'L-SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT',
    AltRight: 'R-ALT',
    Escape: 'ESC',
    Enter: 'ENTER',
    Tab: 'TAB',
    Backspace: 'BACKSPACE',
    ArrowUp: 'UP',
    ArrowDown: 'DOWN',
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
  };
  if (map[code]) return map[code];
  // KeyW -> W, Digit1 -> 1, Numpad1 -> NUM 1, F1 -> F1
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  if (code.startsWith('F') && code.length === 2) return code;
  return code;
}

export class Keybinds {
  constructor() {
    this.bindings = { ...DEFAULT_KEYBINDS };
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        // Merge over defaults so new actions get their defaults if missing.
        this.bindings = { ...DEFAULT_KEYBINDS, ...saved };
      }
    } catch (e) { /* storage unavailable — keep defaults */ }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (e) { /* ignore */ }
  }

  reset() {
    this.bindings = { ...DEFAULT_KEYBINDS };
    this.save();
  }

  // Get the key code bound to an action.
  get(action) {
    return this.bindings[action] || DEFAULT_KEYBINDS[action] || null;
  }

  // Bind a key code to an action. Returns the action that was previously
  // using this key (if any) so the caller can warn about conflicts.
  set(action, code) {
    const prev = this.bindings[action];
    this.bindings[action] = code;
    this.save();
    return prev;
  }

  // Find which action (if any) currently uses this key code.
  actionFor(code) {
    for (const [action, bound] of Object.entries(this.bindings)) {
      if (bound === code) return action;
    }
    return null;
  }

  // True if the given key code is bound to any action.
  isBound(code) {
    return this.actionFor(code) !== null;
  }
}