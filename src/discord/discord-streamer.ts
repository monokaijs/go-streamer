import { Client } from 'discord.js-selfbot-v13';
import { Streamer, playStream } from '@dank074/discord-video-stream';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import { config } from '../config.js';
import { CommandHandler } from './command-handler.js';
import type { BrowserManager } from '../browser/browser-manager.js';

interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
}

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
}

export class DiscordStreamer {
  private streamer: Streamer;
  private client: Client;
  private streaming = false;
  private ffmpegProcess: any = null;
  private loggedIn = false;
  private currentGuildId: string | null = null;
  private currentChannelId: string | null = null;
  private streamWidth = config.stream.width;
  private streamHeight = config.stream.height;
  private streamFps = config.stream.fps;
  private commandHandler: CommandHandler | null = null;
  private browserManager: BrowserManager | null = null;
  private pendingRestart = false;

  constructor() {
    this.client = new Client();
    this.streamer = new Streamer(this.client);
  }

  setBrowserManager(browserManager: BrowserManager) {
    this.browserManager = browserManager;
  }

  async login() {
    if (!config.discord.token) return;
    await this.client.login(config.discord.token);
    this.loggedIn = true;
    console.log(`[Discord] Logged in as ${this.client.user?.tag}`);

    if (this.browserManager) {
      const channelIds = config.discord.commandChannels;
      this.commandHandler = new CommandHandler(this.client, this.browserManager, channelIds);
      this.commandHandler.start();
    }
  }

  isLoggedIn() {
    return this.loggedIn;
  }

  isStreaming() {
    return this.streaming;
  }

  getGuilds(): GuildInfo[] {
    if (!this.loggedIn) return [];
    return this.client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 64 }) || null,
    }));
  }

  getVoiceChannels(guildId: string): ChannelInfo[] {
    if (!this.loggedIn) return [];
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return [];
    return guild.channels.cache
      .filter(c => c.type === 'GUILD_VOICE' || c.type === 'GUILD_STAGE_VOICE')
      .map(c => ({
        id: c.id,
        name: c.name,
        type: c.type === 'GUILD_STAGE_VOICE' ? 'stage' : 'voice',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getStatus() {
    return {
      loggedIn: this.loggedIn,
      streaming: this.streaming,
      username: this.client.user?.tag || null,
      guildId: this.currentGuildId,
      channelId: this.currentChannelId,
    };
  }

  setStreamResolution(width: number, height: number) {
    this.streamWidth = width;
    this.streamHeight = height;
  }

  setStreamFps(fps: number) {
    this.streamFps = fps;
    if (this.streaming) {
      this.restartStreamLoop();
    }
  }

  getStreamFps() {
    return this.streamFps;
  }

  private restartStreamLoop() {
    this.pendingRestart = true;
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM');
    }
  }

  async startStream(guildId: string, channelId: string) {
    if (!this.loggedIn) throw new Error('Not logged in');
    if (this.streaming) {
      await this.stopStream();
    }

    this.currentGuildId = guildId;
    this.currentChannelId = channelId;

    await this.streamer.joinVoice(guildId, channelId);
    console.log(`[Discord] Joined voice channel ${channelId}`);
    this.startStreamLoop();
  }

  private async startStreamLoop() {


    const { width, height, fps } = {
      width: this.streamWidth,
      height: this.streamHeight,
      fps: this.streamFps,
    };

    const display = process.env.DISPLAY || ':99';
    const useXvfb = !!process.env.DISPLAY;
    const usePulse = !!process.env.PULSE_SERVER;

    let hwAccel: 'nvenc' | 'vaapi' | 'none' = 'none';
    try {
      execSync('nvidia-smi', { timeout: 3000, stdio: 'ignore' });
      hwAccel = 'nvenc';
      console.log('[Discord] HW accel: NVENC detected');
    } catch {
      try {
        if (fs.existsSync('/dev/dri/renderD128')) {
          execSync(
            'ffmpeg -y -vaapi_device /dev/dri/renderD128 -f lavfi -i color=c=black:s=64x64:r=1:d=1 -vf format=nv12,hwupload -c:v h264_vaapi -frames:v 1 -f null -',
            { timeout: 5000, stdio: 'ignore' },
          );
          hwAccel = 'vaapi';
          console.log('[Discord] HW accel: VAAPI detected (h264_vaapi test passed)');
        }
      } catch (e: any) {
        console.log(`[Discord] HW accel: VAAPI test failed, using software: ${e.message?.split('\n')[0]}`);
      }
    }
    console.log(`[Discord] HW accel selected: ${hwAccel}`);

    const hwInit = hwAccel === 'vaapi'
      ? ['-vaapi_device', '/dev/dri/renderD128']
      : [];

    let videoInput: string[];
    if (useXvfb) {
      videoInput = [
        '-use_wallclock_as_timestamps', '1',
        '-thread_queue_size', '512',
        '-f', 'x11grab',
        '-framerate', String(fps),
        '-video_size', `${width}x${height}`,
        '-draw_mouse', '0',
        '-i', display,
      ];
    } else {
      videoInput = [
        '-f', 'lavfi',
        '-i', `color=c=black:s=${width}x${height}:r=${fps}`,
      ];
    }

    const audioInput = usePulse
      ? ['-use_wallclock_as_timestamps', '1', '-thread_queue_size', '512', '-f', 'pulse', '-i', 'virtual_sink.monitor']
      : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];

    let videoEncode: string[];
    if (hwAccel === 'nvenc') {
      videoEncode = [
        '-c:v', 'h264_nvenc',
        '-preset', 'p4', '-tune', 'll',
        '-pix_fmt', 'yuv420p',
        '-b:v', '5000k', '-maxrate:v', '7500k', '-bufsize:v', '2500k',
        '-bf', '0',
      ];
    } else if (hwAccel === 'vaapi') {
      videoEncode = [
        '-vf', 'format=nv12,hwupload',
        '-c:v', 'h264_vaapi',
        '-rc_mode', 'CQP', '-qp', '23',
        '-bf', '0',
      ];
    } else {
      videoEncode = [
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-b:v', '5000k', '-maxrate:v', '7500k', '-bufsize:v', '2500k',
        '-bf', '0',
      ];
    }

    const ffmpegArgs = [
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-probesize', '32',
      '-analyzeduration', '0',
      ...hwInit,
      ...videoInput,
      ...audioInput,
      '-map', '0:v', '-map', '1:a',
      ...videoEncode,
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-c:a', 'libopus', '-b:a', '128k', '-ac', '2', '-ar', '48000',
      '-async', '1',
      '-f', 'nut', 'pipe:1',
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.ffmpegProcess = ffmpeg;

    let stderrLineCount = 0;
    ffmpeg.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      stderrLineCount++;
      if (stderrLineCount <= 20 || msg.includes('Error') || msg.includes('error')) {
        console.log('[Discord] FFmpeg:', msg);
      }
    });

    ffmpeg.on('close', (code: number | null) => {
      console.log(`[Discord] FFmpeg exited with code ${code}`);
    });

    this.streaming = true;
    const mode = useXvfb ? `x11grab(${display})` : 'fallback';
    const audio = usePulse ? 'pulse' : 'silent';
    const encoder = hwAccel === 'nvenc' ? 'h264_nvenc' : hwAccel === 'vaapi' ? 'h264_vaapi' : 'libx264';
    console.log(`[Discord] Go Live at ${width}x${height}@${fps}fps [video:${mode} encoder:${encoder} audio:${audio}]`);

    try {
      await playStream(ffmpeg.stdout!, this.streamer, {
        type: 'go-live',
        width,
        height,
        frameRate: fps,
      });

      console.log('[Discord] Stream ended');
    } catch (err) {
      console.error('[Discord] Streaming error:', err);
    } finally {
      ffmpeg.kill('SIGTERM');
      this.ffmpegProcess = null;
      if (this.pendingRestart) {
        this.pendingRestart = false;
        console.log('[Discord] Restarting stream with new settings...');
        this.startStreamLoop();
      } else {
        this.streaming = false;
      }
    }
  }

  async stopStream() {
    this.streaming = false;
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }
    try {
      this.streamer.stopStream();
    } catch {}
    this.currentGuildId = null;
    this.currentChannelId = null;
    console.log('[Discord] Stream stopped');
  }

  async shutdown() {
    await this.stopStream();
    if (this.loggedIn) {
      this.client.destroy();
    }
    console.log('[Discord] Disconnected');
  }
}
