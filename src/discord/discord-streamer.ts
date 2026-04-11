import { Client } from 'discord.js-selfbot-v13';
import { Streamer, playStream } from '@dank074/discord-video-stream';
import { PassThrough } from 'stream';
import { config } from '../config.js';

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
  private frameStream: PassThrough | null = null;
  private streaming = false;
  private frameInterval: NodeJS.Timeout | null = null;
  private latestFrame: Buffer | null = null;
  private loggedIn = false;
  private currentGuildId: string | null = null;
  private currentChannelId: string | null = null;
  private streamWidth = config.stream.width;
  private streamHeight = config.stream.height;
  private streamFps = config.stream.fps;

  constructor() {
    this.client = new Client();
    this.streamer = new Streamer(this.client);
  }

  async login() {
    if (!config.discord.token) return;
    await this.client.login(config.discord.token);
    this.loggedIn = true;
    console.log(`[Discord] Logged in as ${this.client.user?.tag}`);
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
    const { spawn } = await import('child_process');

    const { width, height, fps } = {
      width: this.streamWidth,
      height: this.streamHeight,
      fps: this.streamFps,
    };

    const ffmpegArgs = [
      '-y',
      '-f', 'image2pipe',
      '-framerate', String(fps),
      '-c:v', 'mjpeg',
      '-i', 'pipe:0',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=stereo',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', '5000k',
      '-maxrate', '7500k',
      '-bufsize', '10000k',
      '-g', String(fps * 2),
      '-pix_fmt', 'yuv420p',
      '-vf', `scale=${width}:${height}`,
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'matroska',
      '-map', '0:v',
      '-map', '1:a',
      'pipe:1',
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    ffmpegProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        console.error('[Discord] FFmpeg:', msg.trim());
      }
    });

    ffmpegProcess.on('close', (code: number | null) => {
      console.log(`[Discord] FFmpeg exited with code ${code}`);
    });

    this.frameStream = new PassThrough();
    this.frameStream.pipe(ffmpegProcess.stdin!);

    this.frameInterval = setInterval(() => {
      if (this.latestFrame && this.frameStream && !this.frameStream.destroyed) {
        this.frameStream.write(this.latestFrame);
      }
    }, 1000 / fps);

    this.streaming = true;
    console.log('[Discord] Go Live started (with audio)');

    try {
      await playStream(ffmpegProcess.stdout!, this.streamer, {
        type: 'go-live',
        width,
        height,
        frameRate: fps,
      });

      console.log('[Discord] Stream ended');
    } catch (err) {
      console.error('[Discord] Streaming error:', err);
    } finally {
      this.streaming = false;
      if (this.frameInterval) {
        clearInterval(this.frameInterval);
        this.frameInterval = null;
      }
      ffmpegProcess.kill('SIGTERM');
    }
  }

  async stopStream() {
    this.streaming = false;
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    if (this.frameStream) {
      this.frameStream.end();
      this.frameStream = null;
    }
    try {
      this.streamer.stopStream();
    } catch {}
    this.currentGuildId = null;
    this.currentChannelId = null;
    console.log('[Discord] Stream stopped');
  }

  pushFrame(frameBase64: string) {
    const buffer = Buffer.from(frameBase64, 'base64');
    this.latestFrame = buffer;
  }

  async shutdown() {
    await this.stopStream();
    if (this.loggedIn) {
      this.client.destroy();
    }
    console.log('[Discord] Disconnected');
  }
}
