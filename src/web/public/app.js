let socket = null;

const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const appEl = document.getElementById('app');

function connectSocket(token) {
  if (socket) {
    socket.disconnect();
  }

  socket = io({ auth: { token } });

  socket.on('connect', () => {
    loginScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
    if (token) {
      sessionStorage.setItem('go_streamer_token', token);
    }
    onConnected();
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'AUTH_REQUIRED') {
      loginScreen.classList.remove('hidden');
      appEl.classList.add('hidden');
      sessionStorage.removeItem('go_streamer_token');
      loginError.classList.remove('hidden');
      loginPassword.focus();
    }
  });

  socket.on('disconnect', () => {
    onDisconnected();
  });

  setupSocketListeners();
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = loginPassword.value.trim();
  if (!pw) return;
  loginError.classList.add('hidden');
  connectSocket(pw);
});



const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const tabBar = document.getElementById('tab-bar');
const urlBar = document.getElementById('url-bar');
const overlay = document.getElementById('overlay');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const fpsCounter = document.getElementById('fps-counter');
const resolutionDisplay = document.getElementById('resolution-display');
const settingsPanel = document.getElementById('settings-panel');
const settingsBackdrop = document.getElementById('settings-backdrop');
const customWidthInput = document.getElementById('custom-width');
const customHeightInput = document.getElementById('custom-height');

let tabs = [];
let activeTabId = null;
let canvasRect = null;
let streamWidth = 1280;
let streamHeight = 720;
let frameCount = 0;
let lastFpsTime = Date.now();
let connected = false;

function updateCanvasRect() {
  canvasRect = canvas.getBoundingClientRect();
}
window.addEventListener('resize', updateCanvasRect);
updateCanvasRect();

const resizeObserver = new ResizeObserver(() => {
  updateCanvasRect();
});
resizeObserver.observe(canvas);

function onConnected() {
  connected = true;
  statusDot.className = 'status-dot connected';
  statusText.textContent = 'Connected';
  overlay.classList.add('hidden');
}

function onDisconnected() {
  connected = false;
  statusDot.className = 'status-dot';
  statusText.textContent = 'Disconnected';
  overlay.classList.remove('hidden');
}

function setupSocketListeners() {
  socket.on('frame', (base64) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      frameCount++;
    };
    img.src = 'data:image/jpeg;base64,' + base64;
  });

setInterval(() => {
  const now = Date.now();
  const elapsed = (now - lastFpsTime) / 1000;
  const fps = Math.round(frameCount / elapsed);
  fpsCounter.textContent = fps + ' FPS';
  frameCount = 0;
  lastFpsTime = now;
}, 1000);

  socket.on('tabs:updated', (tabList) => {
    tabs = tabList;
    renderTabs();
    const active = tabs.find(t => t.active);
    if (active) {
      activeTabId = active.id;
      urlBar.value = active.url === 'about:blank' ? '' : active.url;
    }
  });

function renderTabs() {
  const existingNew = tabBar.querySelector('.tab-new');
  tabBar.innerHTML = '';

  tabs.forEach(tab => {
    const el = document.createElement('button');
    el.className = 'tab' + (tab.active ? ' active' : '');
    el.dataset.tabId = tab.id;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || tab.url || 'New Tab';
    el.appendChild(title);

    if (tabs.length > 1) {
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('tab:close', tab.id);
      });
      el.appendChild(close);
    }

    el.addEventListener('click', () => {
      socket.emit('tab:switch', tab.id);
    });

    tabBar.appendChild(el);
  });

  const newBtn = document.createElement('button');
  newBtn.className = 'tab-new';
  newBtn.textContent = '+';
  newBtn.title = 'New Tab';
  newBtn.addEventListener('click', () => {
    socket.emit('tab:create');
  });
  tabBar.appendChild(newBtn);
}

document.getElementById('btn-back').addEventListener('click', () => {
  socket.emit('nav:back');
});

document.getElementById('btn-forward').addEventListener('click', () => {
  socket.emit('nav:forward');
});

document.getElementById('btn-reload').addEventListener('click', () => {
  socket.emit('nav:reload');
});

urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const url = urlBar.value.trim();
    if (url) {
      socket.emit('navigate', url);
      canvas.focus();
    }
  }
});

urlBar.addEventListener('focus', () => {
  urlBar.select();
});

function mapCoords(clientX, clientY) {
  if (!canvasRect) updateCanvasRect();
  const displayWidth = canvasRect.width;
  const displayHeight = canvasRect.height;

  const scaleX = streamWidth / displayWidth;
  const scaleY = streamHeight / displayHeight;

  const aspectStream = streamWidth / streamHeight;
  const aspectDisplay = displayWidth / displayHeight;

  let offsetX = 0, offsetY = 0, renderWidth = displayWidth, renderHeight = displayHeight;

  if (aspectDisplay > aspectStream) {
    renderWidth = displayHeight * aspectStream;
    offsetX = (displayWidth - renderWidth) / 2;
  } else {
    renderHeight = displayWidth / aspectStream;
    offsetY = (displayHeight - renderHeight) / 2;
  }

  const x = ((clientX - canvasRect.left - offsetX) / renderWidth) * streamWidth;
  const y = ((clientY - canvasRect.top - offsetY) / renderHeight) * streamHeight;

  return {
    x: Math.max(0, Math.min(streamWidth, x)),
    y: Math.max(0, Math.min(streamHeight, y)),
  };
}

function getModifiers(e) {
  let mod = 0;
  if (e.altKey) mod |= 1;
  if (e.ctrlKey) mod |= 2;
  if (e.metaKey) mod |= 4;
  if (e.shiftKey) mod |= 8;
  return mod;
}

const canvasContainer = document.querySelector('.canvas-container');

canvasContainer.addEventListener('mousedown', (e) => {
  if (e.target === urlBar || e.target.closest('.navbar') || e.target.closest('.tab-bar')) return;
  const { x, y } = mapCoords(e.clientX, e.clientY);
  socket.emit('mouse', {
    type: 'mousedown',
    x, y,
    button: e.button,
    clickCount: e.detail,
    modifiers: getModifiers(e),
  });
});

canvasContainer.addEventListener('mouseup', (e) => {
  const { x, y } = mapCoords(e.clientX, e.clientY);
  socket.emit('mouse', {
    type: 'mouseup',
    x, y,
    button: e.button,
    modifiers: getModifiers(e),
  });
});

canvasContainer.addEventListener('mousemove', (e) => {
  const { x, y } = mapCoords(e.clientX, e.clientY);
  socket.emit('mouse', {
    type: 'mousemove',
    x, y,
    button: 0,
    modifiers: getModifiers(e),
  });
});

canvasContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { x, y } = mapCoords(e.clientX, e.clientY);
  socket.emit('wheel', {
    x, y,
    deltaX: e.deltaX,
    deltaY: e.deltaY,
    modifiers: getModifiers(e),
  });
}, { passive: false });

canvasContainer.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const { x, y } = mapCoords(e.clientX, e.clientY);
  socket.emit('mouse', {
    type: 'mousedown',
    x, y,
    button: 2,
    clickCount: 1,
    modifiers: getModifiers(e),
  });
  socket.emit('mouse', {
    type: 'mouseup',
    x, y,
    button: 2,
    modifiers: getModifiers(e),
  });
});

document.addEventListener('keydown', (e) => {
  if (document.activeElement === urlBar || document.activeElement === loginPassword) return;

  const interceptKeys = ['Tab', 'F5', 'F11', 'F12'];
  if (e.ctrlKey || e.metaKey) {
    const ctrlKeys = ['t', 'w', 'r', 'l', 'n', 'p', 'f', 'g', 'u', 'j', 'k'];
    if (ctrlKeys.includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  }
  if (interceptKeys.includes(e.key)) {
    e.preventDefault();
  }

  let text = '';
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    text = e.key;
  }

  socket.emit('keyboard', {
    type: 'keydown',
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    modifiers: getModifiers(e),
    text,
    location: e.location,
  });
});

document.addEventListener('keyup', (e) => {
  if (document.activeElement === urlBar || document.activeElement === loginPassword) return;

  socket.emit('keyboard', {
    type: 'keyup',
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    modifiers: getModifiers(e),
    location: e.location,
  });
});

canvasContainer.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touches = Array.from(e.touches).map(t => {
    const { x, y } = mapCoords(t.clientX, t.clientY);
    return { x, y, id: t.identifier };
  });
  socket.emit('touch', { type: 'touchstart', touches });
}, { passive: false });

canvasContainer.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touches = Array.from(e.touches).map(t => {
    const { x, y } = mapCoords(t.clientX, t.clientY);
    return { x, y, id: t.identifier };
  });
  socket.emit('touch', { type: 'touchmove', touches });
}, { passive: false });

canvasContainer.addEventListener('touchend', (e) => {
  e.preventDefault();
  socket.emit('touch', { type: 'touchend', touches: [] });
}, { passive: false });

canvasContainer.addEventListener('touchcancel', (e) => {
  e.preventDefault();
  socket.emit('touch', { type: 'touchcancel', touches: [] });
}, { passive: false });

function openSettings() {
  settingsPanel.classList.remove('hidden');
  settingsBackdrop.classList.remove('hidden');
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
  settingsBackdrop.classList.add('hidden');
}

document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', closeSettings);

function updatePresetHighlight(w, h) {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const bw = parseInt(btn.dataset.w);
    const bh = parseInt(btn.dataset.h);
    btn.classList.toggle('active', bw === w && bh === h);
  });
  customWidthInput.value = w;
  customHeightInput.value = h;
  resolutionDisplay.textContent = w + '×' + h;
}

document.getElementById('resolution-presets').addEventListener('click', (e) => {
  const btn = e.target.closest('.preset-btn');
  if (!btn) return;
  const w = parseInt(btn.dataset.w);
  const h = parseInt(btn.dataset.h);
  socket.emit('settings:resolution', { width: w, height: h });
});

function applyCustomResolution() {
  const w = parseInt(customWidthInput.value);
  const h = parseInt(customHeightInput.value);
  if (w >= 320 && w <= 3840 && h >= 240 && h <= 2160) {
    socket.emit('settings:resolution', { width: w, height: h });
  }
}

customWidthInput.addEventListener('change', applyCustomResolution);
customHeightInput.addEventListener('change', applyCustomResolution);

customWidthInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyCustomResolution();
  e.stopPropagation();
});

customHeightInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyCustomResolution();
  e.stopPropagation();
});

  socket.on('settings:updated', (settings) => {
    streamWidth = settings.width;
    streamHeight = settings.height;
    updatePresetHighlight(settings.width, settings.height);
  });

const guildSelect = document.getElementById('discord-guild');
const channelSelect = document.getElementById('discord-channel');
const streamBtn = document.getElementById('discord-stream-btn');
const discordStatus = document.getElementById('discord-status');
const refreshBtn = document.getElementById('discord-refresh');

let discordState = { loggedIn: false, streaming: false, username: null, guildId: null, channelId: null };

function updateDiscordStatus(state) {
  discordState = state;
  if (!state.loggedIn) {
    discordStatus.innerHTML = '<span class="dot offline"></span> Not connected';
    streamBtn.disabled = true;
    guildSelect.disabled = true;
    channelSelect.disabled = true;
    return;
  }

  if (state.streaming) {
    discordStatus.innerHTML = '<span class="dot streaming"></span> Streaming as ' + state.username;
    streamBtn.textContent = 'Stop Streaming';
    streamBtn.classList.add('streaming');
    streamBtn.disabled = false;
  } else {
    discordStatus.innerHTML = '<span class="dot online"></span> Logged in as ' + state.username;
    streamBtn.textContent = 'Start Streaming';
    streamBtn.classList.remove('streaming');
    guildSelect.disabled = false;
    updateStreamBtnState();
  }
}

function updateStreamBtnState() {
  const hasGuild = guildSelect.value !== '';
  const hasChannel = channelSelect.value !== '';
  streamBtn.disabled = !(hasGuild && hasChannel) && !discordState.streaming;
}

function loadGuilds() {
  refreshBtn.classList.add('spinning');
  socket.emit('discord:guilds', null, (guilds) => {
    refreshBtn.classList.remove('spinning');
    const current = guildSelect.value;
    guildSelect.innerHTML = '<option value="">Select a server...</option>';
    guilds.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      if (g.id === current || g.id === discordState.guildId) opt.selected = true;
      guildSelect.appendChild(opt);
    });
    if (guildSelect.value) {
      loadChannels(guildSelect.value);
    }
  });
}

function loadChannels(guildId) {
  socket.emit('discord:channels', guildId, (channels) => {
    channelSelect.innerHTML = '<option value="">Select a channel...</option>';
    channelSelect.disabled = false;
    channels.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = (c.type === 'stage' ? '🎭 ' : '🔊 ') + c.name;
      if (c.id === discordState.channelId) opt.selected = true;
      channelSelect.appendChild(opt);
    });
    updateStreamBtnState();
  });
}

guildSelect.addEventListener('change', () => {
  if (guildSelect.value) {
    loadChannels(guildSelect.value);
  } else {
    channelSelect.innerHTML = '<option value="">Select a channel...</option>';
    channelSelect.disabled = true;
    updateStreamBtnState();
  }
});

channelSelect.addEventListener('change', updateStreamBtnState);

streamBtn.addEventListener('click', () => {
  if (discordState.streaming) {
    socket.emit('discord:stop');
    streamBtn.disabled = true;
    streamBtn.textContent = 'Stopping...';
  } else {
    const guildId = guildSelect.value;
    const channelId = channelSelect.value;
    if (guildId && channelId) {
      socket.emit('discord:start', { guildId, channelId });
      streamBtn.disabled = true;
      streamBtn.textContent = 'Connecting...';
    }
  }
});

refreshBtn.addEventListener('click', loadGuilds);

  socket.on('discord:status', (status) => {
    updateDiscordStatus(status);
    if (status.loggedIn && guildSelect.options.length <= 1) {
      loadGuilds();
    }
  });

  socket.on('discord:error', (msg) => {
    console.error('[Discord]', msg);
    streamBtn.disabled = false;
    streamBtn.textContent = 'Start Streaming';
    streamBtn.classList.remove('streaming');
  });
}

const savedToken = sessionStorage.getItem('go_streamer_token');
connectSocket(savedToken || '');
