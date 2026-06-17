/**
 * Flex TV — Bridge Agent
 * Roda no PC da rede local. Conecta ao servidor Render e executa
 * comandos de energia (Wake-on-LAN e Samsung power-off) nas TVs.
 *
 * Uso: node bridge/agent.js
 * Requer: npm install  (dentro da pasta bridge/)
 */

const { io } = require('socket.io-client');
const wol = require('wol');
const WebSocket = require('ws');

// ── Config ─────────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.FLEX_TV_SERVER || 'https://flex-tv.onrender.com';
const SAMSUNG_APP_NAME = Buffer.from('FlexTV').toString('base64'); // "Rmxl0lY"

console.log(`[Bridge] Conectando a ${SERVER_URL}…`);

// ── Socket.io ──────────────────────────────────────────────────────────────────

const socket = io(SERVER_URL, {
  query: { role: 'bridge' },
  reconnectionDelay: 3000,
  reconnectionDelayMax: 15000
});

socket.on('connect', () => {
  console.log('[Bridge] ✅ Conectado ao servidor Flex TV');
});

socket.on('disconnect', reason => {
  console.log(`[Bridge] Desconectado: ${reason} — reconectando…`);
});

socket.on('connect_error', err => {
  console.error(`[Bridge] Erro de conexão: ${err.message}`);
});

// ── Comandos de energia ────────────────────────────────────────────────────────

socket.on('power_command', async ({ tvId, action, mac, ip }) => {
  console.log(`[Bridge] power_command → tvId=${tvId} action=${action} mac=${mac} ip=${ip}`);

  try {
    if (action === 'wake') {
      await wakeTV(mac);
      socket.emit('power_result', { tvId, action: 'wake', success: true });
    } else if (action === 'power_off') {
      await powerOffTV(ip);
      socket.emit('power_result', { tvId, action: 'power_off', success: true });
    } else {
      throw new Error(`Ação desconhecida: ${action}`);
    }
  } catch (err) {
    console.error(`[Bridge] Erro ao executar ${action} na TV ${tvId}:`, err.message);
    socket.emit('power_result', { tvId, action, success: false, error: err.message });
  }
});

// ── Wake-on-LAN ────────────────────────────────────────────────────────────────

function wakeTV(mac) {
  return new Promise((resolve, reject) => {
    if (!mac) return reject(new Error('MAC address não configurado'));
    console.log(`[Bridge] WoL → enviando magic packet para ${mac}`);
    wol.wake(mac, { address: '255.255.255.255' }, err => {
      if (err) return reject(err);
      console.log(`[Bridge] WoL → magic packet enviado para ${mac}`);
      resolve();
    });
  });
}

// ── Samsung Power Off (API WebSocket porta 8002) ───────────────────────────────

function powerOffTV(ip) {
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error('IP não configurado'));

    const wsUrl = `ws://${ip}:8002/api/v2/channels/samsung.remote.control?name=${SAMSUNG_APP_NAME}`;
    console.log(`[Bridge] Samsung API → conectando em ${wsUrl}`);

    let resolved = false;
    const ws = new WebSocket(wsUrl, { rejectUnauthorized: false });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.terminate();
        reject(new Error(`Timeout ao conectar na TV ${ip}:8002`));
      }
    }, 8000);

    ws.on('open', () => {
      console.log(`[Bridge] Samsung API → conectado em ${ip}`);
    });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        // Quando o canal confirma conexão, envia KEY_POWER
        if (msg.event === 'ms.channel.connect') {
          console.log(`[Bridge] Samsung API → canal conectado, enviando KEY_POWER`);
          ws.send(JSON.stringify({
            method: 'ms.remote.control',
            params: {
              Cmd: 'Click',
              DataOfCmd: 'KEY_POWER',
              Option: 'false',
              TypeOfRemote: 'SendRemoteKey'
            }
          }));
          setTimeout(() => {
            clearTimeout(timeout);
            ws.close();
            if (!resolved) { resolved = true; resolve(); }
          }, 1000);
        }
      } catch { /* ignora mensagens não-JSON */ }
    });

    ws.on('error', err => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Erro WebSocket Samsung: ${err.message}`));
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!resolved) { resolved = true; resolve(); }
    });
  });
}
