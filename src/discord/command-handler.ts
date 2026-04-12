import { Client, Message } from 'discord.js-selfbot-v13';
import type { BrowserManager } from '../browser/browser-manager.js';

const PREFIX = '!';

interface CommandContext {
  message: Message;
  args: string[];
  browserManager: BrowserManager;
}

type CommandFn = (ctx: CommandContext) => Promise<void>;

const MEDIA_SCRIPT = {
  getVideo: `(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    return {
      paused: v.paused,
      muted: v.muted,
      volume: Math.round(v.volume * 100),
      currentTime: v.currentTime,
      duration: v.duration || 0,
      src: v.src || v.currentSrc || '',
    };
  })()`,

  play: `(() => {
    const v = document.querySelector('video');
    if (!v) return false;
    v.play();
    return true;
  })()`,

  pause: `(() => {
    const v = document.querySelector('video');
    if (!v) return false;
    v.pause();
    return true;
  })()`,

  togglePlay: `(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    if (v.paused) { v.play(); return 'playing'; }
    else { v.pause(); return 'paused'; }
  })()`,

  setVolume: (vol: number) => `(() => {
    const v = document.querySelector('video');
    if (!v) return false;
    v.volume = ${vol / 100};
    v.muted = false;
    return true;
  })()`,

  mute: `(() => {
    const v = document.querySelector('video');
    if (!v) return false;
    v.muted = true;
    return true;
  })()`,

  unmute: `(() => {
    const v = document.querySelector('video');
    if (!v) return false;
    v.muted = false;
    return true;
  })()`,

  toggleMute: `(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    v.muted = !v.muted;
    return v.muted ? 'muted' : 'unmuted';
  })()`,

  seek: (seconds: number) => `(() => {
    const v = document.querySelector('video');
    if (!v) return false;
    v.currentTime = Math.max(0, Math.min(${seconds}, v.duration || 0));
    return true;
  })()`,

  seekRelative: (delta: number) => `(() => {
    const v = document.querySelector('video');
    if (!v) return false;
    v.currentTime = Math.max(0, Math.min(v.currentTime + (${delta}), v.duration || 0));
    return true;
  })()`,

  fullscreen: `(() => {
    const v = document.querySelector('video');
    if (!v) return false;
    if (v.requestFullscreen) v.requestFullscreen();
    else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
    return true;
  })()`,

  getTitle: `(() => {
    return document.title || '';
  })()`,
};

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function progressBar(current: number, total: number, length = 20): string {
  if (!total || !isFinite(total)) return '▬'.repeat(length);
  const filled = Math.round((current / total) * length);
  return '▓'.repeat(Math.min(filled, length)) + '░'.repeat(Math.max(length - filled, 0));
}

function volumeBar(vol: number): string {
  const blocks = Math.round(vol / 10);
  return '█'.repeat(blocks) + '░'.repeat(10 - blocks);
}

const commands: Record<string, { handler: CommandFn; description: string; usage?: string }> = {
  play: {
    description: 'Resume playback',
    handler: async ({ message, browserManager }) => {
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.play);
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply('▶️ Playback resumed.');
    },
  },

  pause: {
    description: 'Pause playback',
    handler: async ({ message, browserManager }) => {
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.pause);
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply('⏸️ Playback paused.');
    },
  },

  pp: {
    description: 'Toggle play/pause',
    handler: async ({ message, browserManager }) => {
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.togglePlay);
      if (result === null) return void message.reply('⚠️ No video found on the current page.');
      message.reply(result === 'playing' ? '▶️ Playback resumed.' : '⏸️ Playback paused.');
    },
  },

  vol: {
    description: 'Set volume (0-100)',
    usage: '!vol <0-100>',
    handler: async ({ message, args, browserManager }) => {
      const vol = parseInt(args[0]);
      if (isNaN(vol) || vol < 0 || vol > 100) {
        return void message.reply('⚠️ Usage: `!vol <0-100>`');
      }
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.setVolume(vol));
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply(`🔊 Volume set to **${vol}%**\n\`${volumeBar(vol)}\``);
    },
  },

  mute: {
    description: 'Mute audio',
    handler: async ({ message, browserManager }) => {
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.mute);
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply('🔇 Audio muted.');
    },
  },

  unmute: {
    description: 'Unmute audio',
    handler: async ({ message, browserManager }) => {
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.unmute);
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply('🔊 Audio unmuted.');
    },
  },

  m: {
    description: 'Toggle mute/unmute',
    handler: async ({ message, browserManager }) => {
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.toggleMute);
      if (result === null) return void message.reply('⚠️ No video found on the current page.');
      message.reply(result === 'muted' ? '🔇 Audio muted.' : '🔊 Audio unmuted.');
    },
  },

  seek: {
    description: 'Seek to a specific time (seconds or mm:ss)',
    usage: '!seek <time>',
    handler: async ({ message, args, browserManager }) => {
      if (!args[0]) return void message.reply('⚠️ Usage: `!seek <seconds>` or `!seek <mm:ss>`');
      let seconds: number;
      if (args[0].includes(':')) {
        const parts = args[0].split(':').map(Number);
        if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
        else return void message.reply('⚠️ Invalid time format. Use `mm:ss` or `hh:mm:ss`.');
      } else {
        seconds = parseFloat(args[0]);
      }
      if (isNaN(seconds) || seconds < 0) return void message.reply('⚠️ Invalid time value.');
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.seek(seconds));
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply(`⏩ Seeked to **${formatTime(seconds)}**.`);
    },
  },

  ff: {
    description: 'Fast forward (default 10s)',
    usage: '!ff [seconds]',
    handler: async ({ message, args, browserManager }) => {
      const delta = parseInt(args[0]) || 10;
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.seekRelative(delta));
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply(`⏩ Skipped forward **${delta}s**.`);
    },
  },

  rw: {
    description: 'Rewind (default 10s)',
    usage: '!rw [seconds]',
    handler: async ({ message, args, browserManager }) => {
      const delta = parseInt(args[0]) || 10;
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.seekRelative(-delta));
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply(`⏪ Rewound **${delta}s**.`);
    },
  },

  np: {
    description: 'Show now playing info',
    handler: async ({ message, browserManager }) => {
      const [info, title] = await Promise.all([
        browserManager.executeOnActivePage(MEDIA_SCRIPT.getVideo),
        browserManager.executeOnActivePage(MEDIA_SCRIPT.getTitle),
      ]) as [any, string];

      if (!info) return void message.reply('⚠️ No video found on the current page.');

      const status = info.paused ? '⏸️ Paused' : '▶️ Playing';
      const vol = info.muted ? '🔇 Muted' : `🔊 ${info.volume}%`;
      const bar = progressBar(info.currentTime, info.duration);

      const lines = [
        `🎬 **${title || 'Now Playing'}**`,
        `${status} — ${vol}`,
        `\`${formatTime(info.currentTime)}\` ${bar} \`${formatTime(info.duration)}\``,
      ];

      message.reply(lines.join('\n'));
    },
  },

  fs: {
    description: 'Toggle fullscreen on video',
    handler: async ({ message, browserManager }) => {
      const result = await browserManager.executeOnActivePage(MEDIA_SCRIPT.fullscreen);
      if (!result) return void message.reply('⚠️ No video found on the current page.');
      message.reply('🖥️ Fullscreen toggled.');
    },
  },

  goto: {
    description: 'Navigate to a URL',
    usage: '!goto <url>',
    handler: async ({ message, args, browserManager }) => {
      if (!args[0]) return void message.reply('⚠️ Usage: `!goto <url>`');
      await browserManager.navigate(args[0]);
      message.reply(`🌐 Navigating to **${args[0]}**...`);
    },
  },

  reload: {
    description: 'Reload the current page',
    handler: async ({ message, browserManager }) => {
      await browserManager.reload();
      message.reply('🔄 Page reloaded.');
    },
  },

  back: {
    description: 'Go back one page',
    handler: async ({ message, browserManager }) => {
      await browserManager.goBack();
      message.reply('⬅️ Navigated back.');
    },
  },

  forward: {
    description: 'Go forward one page',
    handler: async ({ message, browserManager }) => {
      await browserManager.goForward();
      message.reply('➡️ Navigated forward.');
    },
  },

  click: {
    description: 'Click at coordinates',
    usage: '!click <x> <y>',
    handler: async ({ message, args, browserManager }) => {
      const x = parseInt(args[0]);
      const y = parseInt(args[1]);
      if (isNaN(x) || isNaN(y)) return void message.reply('⚠️ Usage: `!click <x> <y>`');
      await browserManager.clickAt(x, y);
      message.reply(`🖱️ Clicked at **(${x}, ${y})**.`);
    },
  },

  type: {
    description: 'Type text on the page',
    usage: '!type <text>',
    handler: async ({ message, args, browserManager }) => {
      const text = args.join(' ');
      if (!text) return void message.reply('⚠️ Usage: `!type <text>`');
      await browserManager.typeText(text);
      message.reply(`⌨️ Typed: "${text}"`);
    },
  },

  key: {
    description: 'Press a keyboard key',
    usage: '!key <key>',
    handler: async ({ message, args, browserManager }) => {
      if (!args[0]) return void message.reply('⚠️ Usage: `!key <key>` (e.g. Space, Enter, Escape)');
      await browserManager.pressKey(args[0]);
      message.reply(`⌨️ Pressed **${args[0]}**.`);
    },
  },

  help: {
    description: 'Show available commands',
    handler: async ({ message }) => {
      const lines = Object.entries(commands)
        .map(([name, cmd]) => {
          const usage = cmd.usage ? ` — \`${cmd.usage}\`` : '';
          return `\`!${name}\` — ${cmd.description}${usage}`;
        });

      message.reply(`🎮 **Stream Control Commands**\n${lines.join('\n')}`);
    },
  },
};

export class CommandHandler {
  private channelIds: Set<string>;

  constructor(
    private client: Client,
    private browserManager: BrowserManager,
    channelIds: string[],
  ) {
    this.channelIds = new Set(channelIds.filter(Boolean));
  }

  start() {
    this.client.on('messageCreate', (message: Message) => {
      if (message.author.bot) return;
      if (this.channelIds.size > 0 && !this.channelIds.has(message.channelId)) return;
      if (!message.content.startsWith(PREFIX)) return;

      const [rawCmd, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const cmdName = rawCmd.toLowerCase();
      const command = commands[cmdName];
      if (!command) return;

      console.log(`[Discord] Command: !${cmdName} ${args.join(' ')} (by ${message.author.tag})`);
      command.handler({
        message,
        args,
        browserManager: this.browserManager,
      }).catch(err => {
        console.error(`[Discord] Command error:`, err);
        message.reply('❌ An error occurred while executing the command.').catch(() => {});
      });
    });

    const channels = this.channelIds.size > 0
      ? `channels: ${[...this.channelIds].join(', ')}`
      : 'all channels';
    console.log(`[Discord] Command handler active (${channels})`);
  }
}
