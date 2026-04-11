import puppeteer, { Browser, Page, CDPSession, Target } from 'puppeteer';
import { EventEmitter } from 'events';
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

  async launch() {
    const useXvfb = !!process.env.DISPLAY;

    this.browser = await puppeteer.launch({
      headless: !useXvfb,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-infobars',
        '--window-position=0,0',
        `--window-size=${config.stream.width},${config.stream.height}`,
      ],
      defaultViewport: useXvfb ? null : {
        width: config.stream.width,
        height: config.stream.height,
      },
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
        if (page.isClosed()) {
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

    if (this.activePageId) {
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
      this.emit('frame', frame.data);
    });

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 50,
      maxWidth: 960,
      maxHeight: 540,
      everyNthFrame: 2,
    });

    this.screencastRunning = true;
    console.log(`[Browser] Screencast started on tab ${pageId}`);
  }

  async switchTab(pageId: string) {
    const page = this.pages.get(pageId);
    if (!page) return;

    await page.bringToFront();
    await this.startScreencast(pageId);
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
    const tabs: TabInfo[] = [];
    for (const [id, page] of this.pages) {
      if (page.isClosed()) continue;
      tabs.push({
        id,
        title: page.url() === 'about:blank' ? 'New Tab' : (page.title instanceof Function ? 'Loading...' : 'Tab'),
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
    this.currentWidth = width;
    this.currentHeight = height;

    if (this.activePageId) {
      await this.startScreencast(this.activePageId);
    }

    this.emit('settings:updated', this.getSettings());
    console.log(`[Browser] Resolution set to ${width}x${height}`);
  }

  getSettings() {
    return {
      width: this.currentWidth,
      height: this.currentHeight,
    };
  }

  async shutdown() {
    if (this.activeCdp && this.screencastRunning) {
      try {
        await this.activeCdp.send('Page.stopScreencast');
      } catch {}
    }
    if (this.browser) {
      await this.browser.close();
    }
    console.log('[Browser] Shut down');
  }
}

export type { TabInfo };
