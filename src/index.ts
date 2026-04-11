import { config } from './config.js';
import { BrowserManager } from './browser/browser-manager.js';
import { DiscordStreamer } from './discord/discord-streamer.js';
import { WebServer } from './web/server.js';

async function main() {
  console.log('=================================');
  console.log('  Go Streamer');
  console.log('  Browser → Discord Livestream');
  console.log('=================================');
  console.log();

  const browserManager = new BrowserManager();
  const discordStreamer = new DiscordStreamer();
  const webServer = new WebServer(browserManager, discordStreamer);

  const shutdown = async () => {
    console.log('\n[Main] Shutting down...');
    await webServer.shutdown();
    await discordStreamer.shutdown();
    await browserManager.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await browserManager.launch();

    if (config.discord.token) {
      console.log('[Main] Discord token found, logging in...');
      await discordStreamer.login();
      console.log('[Main] Discord ready. Select server & channel from the web UI to start streaming.');
    } else {
      console.log('[Main] No Discord token set, running in web-only mode');
    }

    await webServer.start();
  } catch (err) {
    console.error('[Main] Fatal error:', err);
    await shutdown();
  }
}

main();
