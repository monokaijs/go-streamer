import puppeteer, { Browser, Page, CDPSession, Target } from 'puppeteer';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { InputHandler } from './input-handler.js';
import { config } from '../config.js';

let pageIdCounter = 0;
const pageIdMap = new WeakMap<Page, string>();

function getStablePageId(page: Page): string {
  let id = pageIdMap.get(page);
  if (!id) {
    id = `page_${++pageIdCounter}`;
    pageIdMap.set(page, id);
  }
  return id;
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  active: boolean;
  favicon?: string;
}

export class BrowserManager extends EventEmitter {
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map();
  private cdpSessions: Map<string, CDPSession> = new Map();
  private activePageId: string | null = null;
  private activeCdp: CDPSession | null = null;
  readonly inputHandler = new InputHandler();
  private screencastRunning = false;
  private currentWidth = config.stream.width;
  private currentHeight = config.stream.height;
  private lastFrameTime = 0;
  private readonly previewFps = 15;
  private viewerCount = 0;
  private restarting = false;

  async launch() {
    const useXvfb = !!process.env.DISPLAY;

    this.browser = await puppeteer.launch({
      headless: !useXvfb,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--test-type',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--disable-session-crashed-bubble',
        '--disable-features=InfiniteSessionRestore',
        '--hide-crash-restore-bubble',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--window-position=0,0',
        `--window-size=${config.stream.width},${config.stream.height}`,
        '--app=about:blank',
        '--user-data-dir=/app/data/chrome-profile',
      ],
      defaultViewport: null,
    });

    const pages = await this.browser.pages();
    if (pages.length > 0) {
      await this.registerPage(pages[0]);
      this.activePageId = this.getPageId(pages[0]);
    }

    this.browser.on('targetcreated', async (target: Target) => {
      if (target.type() === 'page') {
        const page = await target.page();
        if (page) {
          await this.registerPage(page);
          const id = this.getPageId(page);
          await this.switchTab(id);
        }
      }
    });

    this.browser.on('targetdestroyed', async () => {
      const closedIds: string[] = [];
      for (const [id, page] of this.pages) {
        try {
          if (page.isClosed()) {
            closedIds.push(id);
          }
        } catch {
          closedIds.push(id);
        }
      }

      for (const id of closedIds) {
        this.pages.delete(id);
        const cdp = this.cdpSessions.get(id);
        if (cdp) {
          cdp.removeAllListeners();
          cdp.detach().catch(() => {});
          this.cdpSessions.delete(id);
        }
      }

      if (closedIds.includes(this.activePageId!)) {
        const remaining = Array.from(this.pages.keys());
        if (remaining.length > 0) {
          await this.switchTab(remaining[remaining.length - 1]);
        }
      }

      this.emit('tabs:updated', this.getTabList());
    });

    this.browser.on('disconnected', () => {
      if (this.restarting) return;
      console.error('[Browser] Chromium crashed unexpectedly, relaunching...');
      this.handleBrowserCrash();
    });

    if (this.activePageId && this.viewerCount > 0) {
      await this.startScreencast(this.activePageId);
    }

    console.log('[Browser] Launched');
  }

  private getPageId(page: Page): string {
    return getStablePageId(page);
  }

  private async registerPage(page: Page) {
    const id = this.getPageId(page);
    this.pages.set(id, page);

    const cdp = await page.createCDPSession();
    this.cdpSessions.set(id, cdp);

    page.on('load', () => {
      this.emit('tabs:updated', this.getTabList());
    });

    page.on('framenavigated', () => {
      this.emit('tabs:updated', this.getTabList());
    });
  }

  private async startScreencast(pageId: string) {
    if (this.screencastRunning && this.activeCdp) {
      try {
        this.activeCdp.removeAllListeners('Page.screencastFrame');
        await this.activeCdp.send('Page.stopScreencast');
      } catch {}
      this.screencastRunning = false;
    }

    const cdp = this.cdpSessions.get(pageId);
    if (!cdp) return;

    this.activeCdp = cdp;
    this.activePageId = pageId;
    this.inputHandler.setCdpSession(cdp);

    cdp.on('Page.screencastFrame', async (frame: any) => {
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
      } catch {}
      if (frame.metadata?.deviceWidth && frame.metadata?.deviceHeight) {
        const vw = frame.metadata.deviceWidth;
        const vh = frame.metadata.deviceHeight;
        if (vw !== this.currentWidth || vh !== this.currentHeight) {
          this.currentWidth = vw;
          this.currentHeight = vh;
          this.emit('settings:updated', this.getSettings());
        }
      }
      const now = Date.now();
      if (now - this.lastFrameTime >= 1000 / this.previewFps) {
        this.lastFrameTime = now;
        this.emit('frame', Buffer.from(frame.data, 'base64'));
      }
    });

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 960,
      maxHeight: 540,
      everyNthFrame: 1,
    });

    this.screencastRunning = true;
    console.log(`[Browser] Screencast started on tab ${pageId}`);
  }

  async switchTab(pageId: string) {
    const page = this.pages.get(pageId);
    if (!page) return;

    await page.bringToFront();
    if (this.viewerCount > 0) {
      await this.startScreencast(pageId);
    } else {
      this.activePageId = pageId;
      const cdp = this.cdpSessions.get(pageId);
      if (cdp) {
        this.activeCdp = cdp;
        this.inputHandler.setCdpSession(cdp);
      }
    }
    this.emit('tabs:updated', this.getTabList());
  }

  async createTab(url?: string) {
    if (!this.browser) return;
    const page = await this.browser.newPage();
    const id = this.getPageId(page);
    if (url) {
      await page.goto(url).catch(() => {});
    }
    await this.switchTab(id);
  }

  async closeTab(pageId: string) {
    const page = this.pages.get(pageId);
    if (!page) return;
    if (this.pages.size <= 1) return;
    await page.close();
  }

  async navigate(url: string) {
    if (!this.activePageId) return;
    const page = this.pages.get(this.activePageId);
    if (!page) return;

    let target = url;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'https://' + target;
    }
    await page.goto(target).catch(() => {});
  }

  async goBack() {
    if (!this.activePageId) return;
    const page = this.pages.get(this.activePageId);
    if (!page) return;
    await page.goBack().catch(() => {});
  }

  async goForward() {
    if (!this.activePageId) return;
    const page = this.pages.get(this.activePageId);
    if (!page) return;
    await page.goForward().catch(() => {});
  }

  async reload() {
    if (!this.activePageId) return;
    const page = this.pages.get(this.activePageId);
    if (!page) return;
    await page.reload().catch(() => {});
  }

  getTabList(): TabInfo[] {
    return this.getTabListSync();
  }

  private getTabListSync(): TabInfo[] {
    const tabs: TabInfo[] = [];
    for (const [id, page] of this.pages) {
      if (page.isClosed()) continue;
      let title = 'Tab';
      try {
        const url = page.url();
        title = url === 'about:blank' ? 'New Tab' : new URL(url).hostname;
      } catch {}
      tabs.push({
        id,
        title,
        url: page.url(),
        active: id === this.activePageId,
      });
    }
    return tabs;
  }

  async getTabListAsync(): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];
    for (const [id, page] of this.pages) {
      if (page.isClosed()) continue;
      let title: string;
      try {
        title = await page.title();
      } catch {
        title = 'Tab';
      }
      tabs.push({
        id,
        title: title || page.url(),
        url: page.url(),
        active: id === this.activePageId,
      });
    }
    return tabs;
  }

  async setResolution(width: number, height: number) {
    const fs = await import('fs');
    fs.writeFileSync('/tmp/stream_resolution', `STREAM_WIDTH=${width}\nSTREAM_HEIGHT=${height}\n`);
    console.log(`[Browser] Resolution changed to ${width}x${height}, restarting...`);
    process.exit(0);
  }

  getSettings() {
    return {
      width: this.currentWidth,
      height: this.currentHeight,
    };
  }

  async executeOnActivePage(script: string): Promise<any> {
    if (!this.activePageId) return null;
    const page = this.pages.get(this.activePageId);
    if (!page || page.isClosed()) return null;
    try {
      return await page.evaluate(script);
    } catch {
      return null;
    }
  }

  async clickAt(x: number, y: number) {
    if (!this.activePageId) return;
    const page = this.pages.get(this.activePageId);
    if (!page || page.isClosed()) return;
    await page.mouse.click(x, y);
  }

  async typeText(text: string) {
    if (!this.activePageId) return;
    const page = this.pages.get(this.activePageId);
    if (!page || page.isClosed()) return;
    await page.keyboard.type(text);
  }

  async pressKey(key: string) {
    if (!this.activePageId) return;
    const page = this.pages.get(this.activePageId);
    if (!page || page.isClosed()) return;
    await page.keyboard.press(key as any);
  }

  addViewer() {
    this.viewerCount++;
    if (this.viewerCount === 1 && this.activePageId && !this.screencastRunning) {
      this.startScreencast(this.activePageId);
    }
  }

  removeViewer() {
    this.viewerCount = Math.max(0, this.viewerCount - 1);
    if (this.viewerCount === 0) {
      this.stopScreencastCapture();
    }
  }

  private async stopScreencastCapture() {
    if (this.screencastRunning && this.activeCdp) {
      try {
        this.activeCdp.removeAllListeners('Page.screencastFrame');
        await this.activeCdp.send('Page.stopScreencast');
      } catch {}
      this.screencastRunning = false;
      console.log('[Browser] Screencast paused (no viewers)');
    }
  }

  private async handleBrowserCrash() {
    this.killBrowserProcessTree();
    this.cleanupState();
    try {
      await this.launch();
    } catch (err) {
      console.error('[Browser] Failed to relaunch after crash:', err);
    }
  }

  private killBrowserProcessTree() {
    try {
      execSync('pkill -9 -f chromium 2>/dev/null || true', { timeout: 5000, stdio: 'ignore' });
    } catch {}
  }

  private cleanupState() {
    for (const cdp of this.cdpSessions.values()) {
      cdp.removeAllListeners();
    }
    this.pages.clear();
    this.cdpSessions.clear();
    this.activePageId = null;
    this.activeCdp = null;
    this.screencastRunning = false;
    this.browser = null;
  }

  async shutdown() {
    this.restarting = true;
    await this.stopScreencastCapture();
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
    }
    this.killBrowserProcessTree();
    this.cleanupState();
    console.log('[Browser] Shut down');
  }
}

export type { TabInfo };
