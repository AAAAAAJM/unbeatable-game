(() => {
  'use strict';

  const BOARD_SIZE = 1000;
  const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
  const BOARD_BYTES = Math.ceil(TOTAL_CELLS / 8);
  const REWARD_INTERVAL_MS = 60 * 60 * 1000;
  const STORAGE_PREFIX = 'unbeatable:v1:';

  const els = {
    canvas: document.getElementById('gameCanvas'),
    frame: document.getElementById('canvasFrame'),
    whiteCount: document.getElementById('whiteCount'),
    remainingCount: document.getElementById('remainingCount'),
    clickBalance: document.getElementById('clickBalance'),
    nextClick: document.getElementById('nextClick'),
    progressPercent: document.getElementById('progressPercent'),
    progressBar: document.getElementById('progressBar'),
    deviceId: document.getElementById('deviceId'),
    statusText: document.getElementById('statusText'),
    toast: document.getElementById('toast'),
    zoomIn: document.getElementById('zoomIn'),
    zoomOut: document.getElementById('zoomOut'),
    resetView: document.getElementById('resetView'),
  };

  const ctx = els.canvas.getContext('2d', { alpha: false });
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = BOARD_SIZE;
  boardCanvas.height = BOARD_SIZE;
  const boardCtx = boardCanvas.getContext('2d', { alpha: false });

  let boardBits = loadBoardBits();
  let whiteCells = countWhiteCells(boardBits);
  let session = loadSession();
  let boardSaveTimer = null;
  let toastTimer = null;
  let lastTick = performance.now();
  let viewInitialized = false;

  const camera = {
    scale: 1,
    x: 0,
    y: 0,
  };

  const pointer = {
    active: false,
    id: null,
    startX: 0,
    startY: 0,
    cameraX: 0,
    cameraY: 0,
    moved: false,
  };

  initDeviceId();
  rebuildBoardTexture();
  bindEvents();
  resizeCanvas();
  updateHud();
  requestAnimationFrame(render);
  setInterval(tickSession, 1000);

  function initDeviceId() {
    let id = safeGet(STORAGE_PREFIX + 'deviceId');
    if (!id) {
      const randomPart = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      id = `ubg-${randomPart}`;
      safeSet(STORAGE_PREFIX + 'deviceId', id);
    }
    session.deviceId = id;
    els.deviceId.textContent = id;
  }

  function loadSession() {
    const raw = safeGet(STORAGE_PREFIX + 'session');
    if (!raw) {
      return {
        clicks: 1,
        activeMs: 0,
        deviceId: null,
      };
    }

    try {
      const parsed = JSON.parse(raw);
      return {
        clicks: Number.isFinite(parsed.clicks) ? Math.max(0, Math.floor(parsed.clicks)) : 1,
        activeMs: Number.isFinite(parsed.activeMs) ? Math.max(0, parsed.activeMs % REWARD_INTERVAL_MS) : 0,
        deviceId: null,
      };
    } catch {
      return { clicks: 1, activeMs: 0, deviceId: null };
    }
  }

  function saveSession() {
    safeSet(STORAGE_PREFIX + 'session', JSON.stringify({
      clicks: session.clicks,
      activeMs: session.activeMs,
    }));
  }

  function loadBoardBits() {
    const encoded = safeGet(STORAGE_PREFIX + 'board');
    if (!encoded) return new Uint8Array(BOARD_BYTES);

    try {
      const binary = atob(encoded);
      if (binary.length !== BOARD_BYTES) return new Uint8Array(BOARD_BYTES);
      const bytes = new Uint8Array(BOARD_BYTES);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      return new Uint8Array(BOARD_BYTES);
    }
  }

  function scheduleBoardSave() {
    clearTimeout(boardSaveTimer);
    boardSaveTimer = setTimeout(() => {
      let binary = '';
      const chunk = 8192;
      for (let start = 0; start < boardBits.length; start += chunk) {
        const end = Math.min(start + chunk, boardBits.length);
        for (let i = start; i < end; i += 1) binary += String.fromCharCode(boardBits[i]);
      }
      safeSet(STORAGE_PREFIX + 'board', btoa(binary));
    }, 180);
  }

  function countWhiteCells(bytes) {
    const lookup = countWhiteCells.lookup || (countWhiteCells.lookup = buildBitCountLookup());
    let count = 0;
    for (let i = 0; i < bytes.length; i += 1) count += lookup[bytes[i]];
    return count;
  }

  function buildBitCountLookup() {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      let count = 0;
      while (value) {
        value &= value - 1;
        count += 1;
      }
      table[i] = count;
    }
    return table;
  }

  function isWhite(index) {
    const byteIndex = index >> 3;
    const mask = 1 << (index & 7);
    return (boardBits[byteIndex] & mask) !== 0;
  }

  function setWhite(index) {
    const byteIndex = index >> 3;
    const mask = 1 << (index & 7);
    if ((boardBits[byteIndex] & mask) !== 0) return false;
    boardBits[byteIndex] |= mask;
    return true;
  }

  function rebuildBoardTexture() {
    const image = boardCtx.createImageData(BOARD_SIZE, BOARD_SIZE);
    const data = image.data;

    for (let index = 0; index < TOTAL_CELLS; index += 1) {
      const value = isWhite(index) ? 255 : 0;
      const offset = index * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }

    boardCtx.putImageData(image, 0, 0);
  }

  function resizeCanvas() {
    const rect = els.frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    els.canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    if (!viewInitialized) {
      resetView();
      viewInitialized = true;
    }
  }

  function resetView() {
    const rect = els.frame.getBoundingClientRect();
    const padding = Math.min(42, rect.width * 0.06);
    camera.scale = Math.max(0.12, Math.min(
      (rect.width - padding * 2) / BOARD_SIZE,
      (rect.height - padding * 2) / BOARD_SIZE,
    ));
    camera.x = (rect.width - BOARD_SIZE * camera.scale) / 2;
    camera.y = (rect.height - BOARD_SIZE * camera.scale) / 2;
  }

  function render() {
    const rect = els.frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = rect.width;
    const height = rect.height;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, width, height);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      boardCanvas,
      camera.x,
      camera.y,
      BOARD_SIZE * camera.scale,
      BOARD_SIZE * camera.scale,
    );

    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(camera.x) + 0.5,
      Math.round(camera.y) + 0.5,
      BOARD_SIZE * camera.scale,
      BOARD_SIZE * camera.scale,
    );

    if (camera.scale >= 8) drawGrid(width, height);
    requestAnimationFrame(render);
  }

  function drawGrid(width, height) {
    const minCol = clamp(Math.floor((-camera.x) / camera.scale), 0, BOARD_SIZE);
    const maxCol = clamp(Math.ceil((width - camera.x) / camera.scale), 0, BOARD_SIZE);
    const minRow = clamp(Math.floor((-camera.y) / camera.scale), 0, BOARD_SIZE);
    const maxRow = clamp(Math.ceil((height - camera.y) / camera.scale), 0, BOARD_SIZE);

    ctx.beginPath();
    ctx.strokeStyle = camera.scale >= 18 ? 'rgba(120,120,120,.28)' : 'rgba(120,120,120,.16)';
    ctx.lineWidth = 1;

    for (let col = minCol; col <= maxCol; col += 1) {
      const x = Math.round(camera.x + col * camera.scale) + 0.5;
      ctx.moveTo(x, camera.y + minRow * camera.scale);
      ctx.lineTo(x, camera.y + maxRow * camera.scale);
    }

    for (let row = minRow; row <= maxRow; row += 1) {
      const y = Math.round(camera.y + row * camera.scale) + 0.5;
      ctx.moveTo(camera.x + minCol * camera.scale, y);
      ctx.lineTo(camera.x + maxCol * camera.scale, y);
    }

    ctx.stroke();
  }

  function bindEvents() {
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('beforeunload', () => {
      saveSession();
      if (boardSaveTimer) {
        clearTimeout(boardSaveTimer);
        boardSaveTimer = null;
        persistBoardNow();
      }
    });

    document.addEventListener('visibilitychange', () => {
      lastTick = performance.now();
      els.statusText.textContent = document.visibilityState === 'visible'
        ? 'Active session resumed.'
        : 'Timer paused while this tab is hidden.';
    });

    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    els.canvas.addEventListener('pointerup', onPointerUp);
    els.canvas.addEventListener('pointercancel', onPointerCancel);
    els.canvas.addEventListener('wheel', onWheel, { passive: false });

    els.zoomIn.addEventListener('click', () => zoomAtCenter(1.7));
    els.zoomOut.addEventListener('click', () => zoomAtCenter(1 / 1.7));
    els.resetView.addEventListener('click', resetView);
  }

  function onPointerDown(event) {
    if (pointer.active) return;
    pointer.active = true;
    pointer.id = event.pointerId;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    pointer.cameraX = camera.x;
    pointer.cameraY = camera.y;
    pointer.moved = false;
    els.canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;

    if (Math.hypot(dx, dy) > 4) pointer.moved = true;
    if (!pointer.moved) return;

    camera.x = pointer.cameraX + dx;
    camera.y = pointer.cameraY + dy;
    els.frame.classList.add('dragging');
  }

  function onPointerUp(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;
    if (!pointer.moved) tryClickCell(event);
    pointer.active = false;
    pointer.id = null;
    els.frame.classList.remove('dragging');
  }

  function onPointerCancel() {
    pointer.active = false;
    pointer.id = null;
    els.frame.classList.remove('dragging');
  }

  function tryClickCell(event) {
    const rect = els.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor((x - camera.x) / camera.scale);
    const row = Math.floor((y - camera.y) / camera.scale);

    if (col < 0 || row < 0 || col >= BOARD_SIZE || row >= BOARD_SIZE) return;
    if (session.clicks < 1) {
      showToast('No clicks yet — stay active until the timer reaches 00:00.');
      return;
    }

    const index = row * BOARD_SIZE + col;
    if (!setWhite(index)) {
      showToast('That cell is already white. Your click was not used.');
      return;
    }

    session.clicks -= 1;
    whiteCells += 1;
    boardCtx.fillStyle = '#ffffff';
    boardCtx.fillRect(col, row, 1, 1);
    saveSession();
    scheduleBoardSave();
    updateHud();

    els.statusText.textContent = `Cell ${col + 1}, ${row + 1} turned white.`;
    showToast('1 cell turned white.');
  }

  function onWheel(event) {
    event.preventDefault();
    const rect = els.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0016);
    zoomAround(x, y, factor);
  }

  function zoomAtCenter(factor) {
    const rect = els.canvas.getBoundingClientRect();
    zoomAround(rect.width / 2, rect.height / 2, factor);
  }

  function zoomAround(screenX, screenY, factor) {
    const worldX = (screenX - camera.x) / camera.scale;
    const worldY = (screenY - camera.y) / camera.scale;
    const nextScale = clamp(camera.scale * factor, 0.12, 64);

    camera.scale = nextScale;
    camera.x = screenX - worldX * nextScale;
    camera.y = screenY - worldY * nextScale;
  }

  function tickSession() {
    const now = performance.now();
    const delta = Math.min(Math.max(now - lastTick, 0), 2500);
    lastTick = now;

    if (document.visibilityState !== 'visible') {
      updateHud();
      return;
    }

    session.activeMs += delta;
    if (session.activeMs >= REWARD_INTERVAL_MS) {
      const earned = Math.floor(session.activeMs / REWARD_INTERVAL_MS);
      session.activeMs %= REWARD_INTERVAL_MS;
      session.clicks += earned;
      showToast(`+${earned} CLICK earned for active time.`);
      els.statusText.textContent = 'Hourly click earned. Keep the page active for the next one.';
    }

    saveSession();
    updateHud();
  }

  function updateHud() {
    const remaining = TOTAL_CELLS - whiteCells;
    const progress = (whiteCells / TOTAL_CELLS) * 100;
    const timeLeft = Math.max(0, REWARD_INTERVAL_MS - session.activeMs);

    els.whiteCount.textContent = whiteCells.toLocaleString('en-US');
    els.remainingCount.textContent = remaining.toLocaleString('en-US');
    els.clickBalance.textContent = session.clicks.toLocaleString('en-US');
    els.progressPercent.textContent = `${progress.toFixed(3)}%`;
    els.progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    els.nextClick.textContent = formatCountdown(timeLeft);
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function persistBoardNow() {
    let binary = '';
    const chunk = 8192;
    for (let start = 0; start < boardBits.length; start += chunk) {
      const end = Math.min(start + chunk, boardBits.length);
      for (let i = start; i < end; i += 1) binary += String.fromCharCode(boardBits[i]);
    }
    safeSet(STORAGE_PREFIX + 'board', btoa(binary));
  }

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Prototype can still run without persistence. */ }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
