import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import type { BrowserManager } from '../browser/browser-manager.js';
import type { DiscordStreamer } from '../discord/discord-streamer.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function resolvePublicDir(): string {
  if (currentDir.includes('dist')) {
    return path.join(currentDir, 'public');
  }
  return path.join(currentDir, 'public');
}

export class WebServer {
  private app = express();
  private httpServer = createServer(this.app);
  private io = new SocketIOServer(this.httpServer, {
    cors: { origin: '*' },
    maxHttpBufferSize: 10e6,
  });

  constructor(
    private browserManager: BrowserManager,
    private discordStreamer: DiscordStreamer,
  ) {}

  async start() {
    this.app.use(express.static(resolvePublicDir()));

    if (config.auth.secret) {
      this.io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (token === config.auth.secret) {
          return next();
        }
        next(new Error('AUTH_REQUIRED'));
      });
    }

    this.io.on('connection', async (socket) => {
      console.log(`[Web] Client connected: ${socket.id}`);

      const tabs = await this.browserManager.getTabListAsync();
      socket.emit('tabs:updated', tabs);
      socket.emit('settings:updated', this.browserManager.getSettings());
      socket.emit('discord:status', this.discordStreamer.getStatus());

      socket.on('mouse', (data) => {
        this.browserManager.inputHandler.handleMouse(data);
      });

      socket.on('wheel', (data) => {
        this.browserManager.inputHandler.handleWheel(data);
      });

      socket.on('keyboard', (data) => {
        this.browserManager.inputHandler.handleKeyboard(data);
      });

      socket.on('touch', (data) => {
        this.browserManager.inputHandler.handleTouch(data);
      });

      socket.on('tab:switch', (tabId: string) => {
        this.browserManager.switchTab(tabId);
      });

      socket.on('tab:close', (tabId: string) => {
        this.browserManager.closeTab(tabId);
      });

      socket.on('tab:create', (url?: string) => {
        this.browserManager.createTab(url);
      });

      socket.on('navigate', (url: string) => {
        this.browserManager.navigate(url);
      });

      socket.on('nav:back', () => {
        this.browserManager.goBack();
      });

      socket.on('nav:forward', () => {
        this.browserManager.goForward();
      });

      socket.on('nav:reload', () => {
        this.browserManager.reload();
      });

      socket.on('settings:resolution', async (data: { width: number; height: number }) => {
        this.discordStreamer.setStreamResolution(data.width, data.height);
        await this.browserManager.setResolution(data.width, data.height);
      });

      socket.on('discord:guilds', (_, callback) => {
        if (typeof callback === 'function') {
          callback(this.discordStreamer.getGuilds());
        }
      });

      socket.on('discord:channels', (guildId: string, callback) => {
        if (typeof callback === 'function') {
          callback(this.discordStreamer.getVoiceChannels(guildId));
        }
      });

      socket.on('discord:start', async (data: { guildId: string; channelId: string }) => {
        try {
          await this.discordStreamer.startStream(data.guildId, data.channelId);
          this.io.emit('discord:status', this.discordStreamer.getStatus());
        } catch (err) {
          socket.emit('discord:error', (err as Error).message);
        }
      });

      socket.on('discord:stop', async () => {
        try {
          await this.discordStreamer.stopStream();
          this.io.emit('discord:status', this.discordStreamer.getStatus());
        } catch (err) {
          socket.emit('discord:error', (err as Error).message);
        }
      });

      socket.on('disconnect', () => {
        console.log(`[Web] Client disconnected: ${socket.id}`);
      });
    });

    let tabUpdateTimer: ReturnType<typeof setTimeout> | null = null;

    this.browserManager.on('frame', (frameBase64: string) => {
      this.io.volatile.emit('frame', frameBase64);
    });

    this.browserManager.on('tabs:updated', (tabs: unknown) => {
      if (tabUpdateTimer) clearTimeout(tabUpdateTimer);
      tabUpdateTimer = setTimeout(() => {
        this.io.emit('tabs:updated', tabs);
      }, 100);
    });

    this.browserManager.on('settings:updated', (settings: unknown) => {
      this.io.emit('settings:updated', settings);
    });

    return new Promise<void>((resolve) => {
      this.httpServer.listen(config.web.port, () => {
        console.log(`[Web] Server running at http://localhost:${config.web.port}`);
        resolve();
      });
    });
  }

  async shutdown() {
    this.io.close();
    this.httpServer.close();
    console.log('[Web] Server stopped');
  }
}
