const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.DASHBOARD_PASSWORD
  ? bcrypt.hashSync(process.env.DASHBOARD_PASSWORD, 10)
  : bcrypt.hashSync('flex2024', 10);

// ── Estado em memória ──────────────────────────────────────────────────────────

/** @type {Map<string, {id:string, name:string, socketId:string|null, status:string, currentContent:object|null, connectedAt:number}>} */
const tvs = new Map();

/** @type {Array<{id:string, label:string, type:string, url?:string, html?:string, countdown?:object, createdAt:number}>} */
const contentLibrary = [];

/** @type {Set<string>} tokens de sessão do dashboard */
const dashboardTokens = new Set();

/** @type {Map<string, {mac:string, ip:string, name?:string}>} configuração de energia por tvId */
const tvConfig = new Map();

/** Socket do agente bridge local (único) */
let bridgeSocket = null;

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(express.json());
app.use('/player', express.static(path.join(__dirname, '../public/player')));
app.use('/dashboard', express.static(path.join(__dirname, '../public/dashboard')));
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));

app.get('/', (_req, res) => res.redirect('/dashboard'));

// ── REST: Auth ─────────────────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Senha obrigatória' });
  if (!bcrypt.compareSync(password, PASSWORD_HASH))
    return res.status(401).json({ error: 'Senha incorreta' });
  const token = randomUUID();
  dashboardTokens.add(token);
  res.json({ token });
});

// ── REST: Auth middleware ──────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.headers['x-flex-token'];
  if (!token || !dashboardTokens.has(token))
    return res.status(401).json({ error: 'Não autenticado' });
  next();
}

// ── REST: Conteúdo ─────────────────────────────────────────────────────────────

app.get('/api/content', requireAuth, (_req, res) => {
  res.json(contentLibrary);
});

app.post('/api/content', requireAuth, (req, res) => {
  const { label, type, url, html, countdown } = req.body || {};
  if (!label || !type) return res.status(400).json({ error: 'label e type são obrigatórios' });
  const item = { id: randomUUID(), label, type, url, html, countdown, createdAt: Date.now() };
  contentLibrary.unshift(item);
  res.status(201).json(item);
});

app.delete('/api/content/:id', requireAuth, (req, res) => {
  const idx = contentLibrary.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  contentLibrary.splice(idx, 1);
  res.json({ ok: true });
});

// ── REST: Configuração de energia por TV ───────────────────────────────────────

app.get('/api/tv-config', requireAuth, (_req, res) => {
  const result = {};
  tvConfig.forEach((cfg, tvId) => { result[tvId] = cfg; });
  res.json(result);
});

app.post('/api/tv-config', requireAuth, (req, res) => {
  const { tvId, mac, ip, name } = req.body || {};
  if (!tvId) return res.status(400).json({ error: 'tvId obrigatório' });
  tvConfig.set(tvId, { mac: mac || '', ip: ip || '', name: name || '' });

  // Atualiza nome da TV na lista principal se fornecido
  if (name) {
    const tv = tvs.get(tvId);
    if (tv) tv.name = name;
  }
  broadcastTvList();
  res.json({ ok: true });
});

// ── REST: Comando de energia (ligar/desligar via bridge) ───────────────────────

app.post('/api/power', requireAuth, (req, res) => {
  const { tvIds, action } = req.body || {};
  if (!['wake', 'power_off'].includes(action))
    return res.status(400).json({ error: 'action deve ser wake ou power_off' });

  if (!bridgeSocket) return res.status(503).json({ error: 'Bridge local não conectado. Rode node bridge/agent.js no PC da rede.' });

  const targets = tvIds === 'all'
    ? [...tvs.keys()]
    : Array.isArray(tvIds) ? tvIds : [tvIds];

  const sent = [];
  const missing = [];

  targets.forEach(tvId => {
    const cfg = tvConfig.get(tvId);
    if (!cfg || (!cfg.mac && !cfg.ip)) { missing.push(tvId); return; }
    bridgeSocket.emit('power_command', { tvId, action, mac: cfg.mac, ip: cfg.ip });
    sent.push(tvId);
  });

  res.json({ sent: sent.length, missing });
});

// ── REST: TVs ──────────────────────────────────────────────────────────────────

app.get('/api/tvs', requireAuth, (_req, res) => {
  res.json(sanitizeTvList());
});

app.post('/api/command', requireAuth, (req, res) => {
  const { tvIds, payload } = req.body || {};
  const targets = tvIds === 'all' ? [...tvs.values()] : (tvIds || []).map(id => tvs.get(id)).filter(Boolean);
  if (!targets.length) return res.status(404).json({ error: 'Nenhuma TV encontrada' });

  targets.forEach(tv => {
    if (!tv.socketId) return;
    io.to(tv.socketId).emit('command', payload);
    if (payload.action === 'show') { tv.status = 'exibindo'; tv.currentContent = payload.content; }
    else if (payload.action === 'hide') { tv.status = 'standby'; tv.currentContent = null; }
  });

  broadcastTvList();
  res.json({ sent: targets.length });
});

// ── Socket.io ──────────────────────────────────────────────────────────────────

io.on('connection', socket => {
  const role = socket.handshake.query.role; // 'tv' | 'dashboard' | 'bridge'

  // ── TV ─────────────────────────────────────────────────────────────────────
  if (role === 'tv') {
    const tvId = socket.handshake.query.tvId || randomUUID();
    const tvName = socket.handshake.query.tvName || `TV-${tvId.slice(0, 6).toUpperCase()}`;

    const tvData = {
      id: tvId,
      name: tvConfig.get(tvId)?.name || tvName,
      socketId: socket.id,
      status: 'standby',
      currentContent: null,
      connectedAt: Date.now()
    };
    tvs.set(tvId, tvData);
    broadcastTvList();

    socket.emit('registered', { tvId, tvName: tvData.name });

    socket.on('ack', data => {
      const tv = tvs.get(tvId);
      if (tv) { tv.status = data.status; tv.currentContent = data.content || null; }
      broadcastTvList();
    });

    socket.on('disconnect', () => {
      const tv = tvs.get(tvId);
      if (tv) { tv.status = 'offline'; tv.socketId = null; }
      broadcastTvList();
      setTimeout(() => {
        const still = tvs.get(tvId);
        if (still && still.status === 'offline') tvs.delete(tvId);
        broadcastTvList();
      }, 120_000);
    });
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────
  if (role === 'dashboard') {
    const token = socket.handshake.query.token;
    if (!token || !dashboardTokens.has(token)) {
      socket.emit('auth_error');
      socket.disconnect(true);
      return;
    }
    socket.join('dashboards');
    socket.emit('tv_list', sanitizeTvList());
    socket.emit('bridge_status', { connected: !!bridgeSocket });

    socket.on('command', ({ tvIds, payload }) => {
      const targets = tvIds === 'all' ? [...tvs.values()] : (tvIds || []).map(id => tvs.get(id)).filter(Boolean);
      targets.forEach(tv => {
        if (!tv.socketId) return;
        io.to(tv.socketId).emit('command', payload);
        if (payload.action === 'show') { tv.status = 'exibindo'; tv.currentContent = payload.content; }
        if (payload.action === 'hide') { tv.status = 'standby'; tv.currentContent = null; }
      });
      broadcastTvList();
    });

    socket.on('power_command', ({ tvIds, action }) => {
      if (!bridgeSocket) {
        socket.emit('power_error', { message: 'Bridge local não conectado' });
        return;
      }
      const targets = tvIds === 'all' ? [...tvs.keys()] : (Array.isArray(tvIds) ? tvIds : [tvIds]);
      targets.forEach(tvId => {
        const cfg = tvConfig.get(tvId);
        if (!cfg) { socket.emit('power_error', { message: `TV ${tvId} sem MAC/IP configurado` }); return; }
        bridgeSocket.emit('power_command', { tvId, action, mac: cfg.mac, ip: cfg.ip });
      });
    });
  }

  // ── Bridge ──────────────────────────────────────────────────────────────────
  if (role === 'bridge') {
    console.log('[Bridge] Agente local conectado');
    bridgeSocket = socket;
    io.to('dashboards').emit('bridge_status', { connected: true });

    socket.on('power_result', ({ tvId, action, success, error }) => {
      console.log(`[Bridge] power_result tvId=${tvId} action=${action} success=${success}${error ? ' err=' + error : ''}`);
      io.to('dashboards').emit('power_result', { tvId, action, success, error });
    });

    socket.on('disconnect', () => {
      console.log('[Bridge] Agente local desconectado');
      bridgeSocket = null;
      io.to('dashboards').emit('bridge_status', { connected: false });
    });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeTvList() {
  return [...tvs.values()].map(({ socketId: _s, ...rest }) => ({
    ...rest,
    config: tvConfig.get(rest.id) || null
  }));
}

function broadcastTvList() {
  io.to('dashboards').emit('tv_list', sanitizeTvList());
}

// ── Start ──────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Flex TV server rodando na porta ${PORT}`);
  if (!process.env.DASHBOARD_PASSWORD)
    console.warn('[AVISO] DASHBOARD_PASSWORD não definido — usando senha padrão "flex2024"');
});
