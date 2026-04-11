import type { CDPSession } from 'puppeteer';

interface MouseEventData {
  type: 'mousedown' | 'mouseup' | 'mousemove';
  x: number;
  y: number;
  button: number;
  clickCount?: number;
  modifiers?: number;
}

interface WheelEventData {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  modifiers?: number;
}

interface KeyboardEventData {
  type: 'keydown' | 'keyup';
  key: string;
  code: string;
  keyCode: number;
  modifiers?: number;
  text?: string;
  location?: number;
}

interface TouchPoint {
  x: number;
  y: number;
  id: number;
}

interface TouchEventData {
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel';
  touches: TouchPoint[];
}

const MODIFIER_KEYS: Record<string, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
};

function buttonToString(button: number): 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward' {
  switch (button) {
    case 0: return 'left';
    case 1: return 'middle';
    case 2: return 'right';
    case 3: return 'back';
    case 4: return 'forward';
    default: return 'none';
  }
}

function mouseTypeToString(type: string): 'mousePressed' | 'mouseReleased' | 'mouseMoved' {
  switch (type) {
    case 'mousedown': return 'mousePressed';
    case 'mouseup': return 'mouseReleased';
    default: return 'mouseMoved';
  }
}

export class InputHandler {
  private cdp: CDPSession | null = null;

  setCdpSession(cdp: CDPSession) {
    this.cdp = cdp;
  }

  async handleMouse(data: MouseEventData) {
    if (!this.cdp) return;
    try {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: mouseTypeToString(data.type),
        x: data.x,
        y: data.y,
        button: buttonToString(data.button),
        clickCount: data.clickCount || 1,
        modifiers: data.modifiers || 0,
      });
    } catch {}
  }

  async handleWheel(data: WheelEventData) {
    if (!this.cdp) return;
    try {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: data.x,
        y: data.y,
        deltaX: data.deltaX,
        deltaY: data.deltaY,
        modifiers: data.modifiers || 0,
      });
    } catch {}
  }

  async handleKeyboard(data: KeyboardEventData) {
    if (!this.cdp) return;
    try {
      const isKeyDown = data.type === 'keydown';
      const cdpType = isKeyDown
        ? (data.text ? 'keyDown' : 'rawKeyDown')
        : 'keyUp';

      await this.cdp.send('Input.dispatchKeyEvent', {
        type: cdpType,
        key: data.key,
        code: data.code,
        windowsVirtualKeyCode: data.keyCode,
        nativeVirtualKeyCode: data.keyCode,
        modifiers: data.modifiers || 0,
        text: isKeyDown ? data.text : undefined,
        unmodifiedText: isKeyDown ? data.text : undefined,
        location: data.location,
      });
    } catch {}
  }

  async handleTouch(data: TouchEventData) {
    if (!this.cdp) return;
    try {
      const touchPoints = data.touches.map(t => ({
        x: t.x,
        y: t.y,
        id: t.id,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      }));

      let cdpType: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
      switch (data.type) {
        case 'touchstart': cdpType = 'touchStart'; break;
        case 'touchmove': cdpType = 'touchMove'; break;
        case 'touchend': cdpType = 'touchEnd'; break;
        default: cdpType = 'touchCancel';
      }

      await this.cdp.send('Input.dispatchTouchEvent', {
        type: cdpType,
        touchPoints,
      });
    } catch {}
  }
}

export type { MouseEventData, WheelEventData, KeyboardEventData, TouchEventData };
