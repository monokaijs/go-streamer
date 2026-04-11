import 'dotenv/config';

export const config = {
  auth: {
    secret: process.env.AUTH_SECRET || '',
  },
  discord: {
    token: process.env.DISCORD_TOKEN || '',
    guildId: process.env.GUILD_ID || '',
    channelId: process.env.CHANNEL_ID || '',
  },
  web: {
    port: parseInt(process.env.WEB_PORT || '3000', 10),
  },
  stream: {
    width: parseInt(process.env.STREAM_WIDTH || '1280', 10),
    height: parseInt(process.env.STREAM_HEIGHT || '720', 10),
    fps: parseInt(process.env.STREAM_FPS || '30', 10),
  },
};
