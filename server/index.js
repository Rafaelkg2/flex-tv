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

/** @type {Map<string, {id:string, name:string, socketId:string, status:string, currentContent:object|null, connectedAt:number}>} */
const tvs = new Map();

/** @type {Array<{id:string, label:string, type:string, url?:string, html?:string, countdown?:object, createdAt:number}>} */
const contentLibrary = [];

/** @type {Set<string>} token de sessão do dashboard */
const dashboardTokens = new Set();

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

// ── REST: Conteúdo ─────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.headers['x-flex-token'];
  if (!token || !dashboardTokens.has(token))
    return res.status(401).json({ error: 'Não autenticado' });
  next();
}

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

// ── REST: TVs ──────────────────────────────────────────────────────────────────

app.get('/api/tvs', requireAuth, (_req, res) => {
  res.json([...tvs.values()].map(({ socketId: _s, ...rest }) => rest));
});

app.post('/api/command', requireAuth, (req, res) => {
  const { tvIds, payload } = req.body || {};
  const targets = tvIds === 'all' ? [...tvs.values()] : (tvIds || []).map(id => tvs.get(id)).filter(Boolean);
  if (!targets.length) return res.status(404).json({ error: 'Nenhuma TV encontrada' });

  targets.forEach(tv => {
    io.to(tv.socketId).emit('command', payload);
    if (payload.action === 'show') {
      tv.status = 'exibindo';
      tv.currentContent = payload.content;
    } else if (payload.action === 'hide') {
      tv.status = 'standby';
      tv.currentContent = null;
    }
  });

  broadcastTvList();
  res.json({ sent: targets.length });
});

// ── Socket.io ──────────────────────────────────────────────────────────────────

io.on('connection', socket => {
  const role = socket.handshake.query.role; // 'tv' | 'dashboard'

  if (role === 'tv') {
    const tvId = socket.handshake.query.tvId || randomUUID();
    const tvName = socket.handshake.query.tvName || `TV-${tvId.slice(0, 6).toUpperCase()}`;

    const tvData = {
      id: tvId,
      name: tvName,
      socketId: socket.id,
      status: 'standby',
      currentContent: null,
      connectedAt: Date.now()
    };
    tvs.set(tvId, tvData);
    broadcastTvList();

    socket.emit('registered', { tvId, tvName });

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

  if (role === 'dashboard') {
    const token = socket.handshake.query.token;
    if (!token || !dashboardTokens.has(token)) {
      socket.emit('auth_error');
      socket.disconnect(true);
      return;
    }
    socket.join('dashboards');
    socket.emit('tv_list', sanitizeTvList());

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
  }
});

function sanitizeTvList() {
  return [...tvs.values()].map(({ socketId: _s, ...rest }) => rest);
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
