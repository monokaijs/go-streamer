import { Client } from 'discord.js-selfbot-v13';
import { Streamer, prepareStream, playStream, Utils, Encoders } from '@dank074/discord-video-stream';
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
    const { width, height, fps } = {
      width: this.streamWidth,
      height: this.streamHeight,
      fps: this.streamFps,
    };

    const inputStream = new PassThrough();
    this.frameStream = inputStream;

    this.frameInterval = setInterval(() => {
      if (this.latestFrame && this.frameStream && !this.frameStream.destroyed) {
        this.frameStream.write(this.latestFrame);
      }
    }, 1000 / fps);

    try {
      const encoder = Encoders.software({
        x264: { preset: 'ultrafast', tune: 'zerolatency' },
      });

      const { command, output } = prepareStream(inputStream, {
        encoder,
        width,
        height,
        frameRate: fps,
        bitrateVideo: 5000,
        bitrateVideoMax: 7500,
        videoCodec: Utils.normalizeVideoCodec('H264'),
        minimizeLatency: true,
        customInputOptions: [
          '-f', 'image2pipe',
          '-framerate', String(fps),
          '-c:v', 'mjpeg',
        ],
        includeAudio: false,
      });

      command.on('error', (err: Error) => {
        console.error('[Discord] FFmpeg error:', err.message);
      });

      this.streaming = true;
      console.log(`[Discord] Go Live started at ${width}x${height}@${fps}fps`);

      await playStream(output, this.streamer, {
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
