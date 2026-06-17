/**
 * Flex TV — Descoberta automática de Samsung TVs na rede
 *
 * Uso: node bridge/discover.js
 * Roda no PC conectado à rede da Grupo Flex.
 * Não precisa de dependências externas.
 */

const net = require('net');
const os = require('os');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SAMSUNG_PORT = 8001;
const CONNECT_TIMEOUT = 1200;  // ms por IP
const CONCURRENT = 40;          // IPs em paralelo

// ── Detecta faixa de rede ─────────────────────────────────────────────────────

function getLocalNetwork() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('127.')) continue;
      // Deriva a faixa /24 (192.168.1.x → 192.168.1)
      const parts = iface.address.split('.');
      return { base: parts.slice(0, 3).join('.'), myIp: iface.address };
    }
  }
  return null;
}

// ── Testa se um IP tem Samsung TV na porta 8001 ───────────────────────────────

function probeSamsungTV(ip) {
  return new Promise(resolve => {
    // 1. Testa se a porta está aberta
    const sock = new net.Socket();
    let open = false;
    sock.setTimeout(CONNECT_TIMEOUT);
    sock.on('connect', () => { open = true; sock.destroy(); });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
    sock.on('close', () => {
      if (!open) return resolve(null);
      // 2. Consulta a API HTTP Samsung
      const req = http.get(`http://${ip}:${SAMSUNG_PORT}/api/v2/`, { timeout: 2000 }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const d = data.device || data;
            if (!d.modelName && !d.name) return resolve(null);
            resolve({
              name: d.name || d.DeviceName || `Samsung TV ${ip}`,
              model: d.modelName || d.model || '—',
              ip,
              mac: ''
            });
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    sock.connect(SAMSUNG_PORT, ip);
  });
}

// ── Lê tabela ARP do Windows para obter MACs ──────────────────────────────────

function getArpTable() {
  const map = {};
  try {
    const out = execSync('arp -a', { encoding: 'utf8', timeout: 5000 });
    const lines = out.split('\n');
    for (const line of lines) {
      const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2})/i);
      if (m) {
        map[m[1]] = m[2].replace(/-/g, ':').toUpperCase();
      }
    }
  } catch { /* Windows pode negar permissão */ }
  return map;
}

// ── Processamento em lotes paralelos ──────────────────────────────────────────

async function scanRange(base) {
  const ips = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
  const results = [];
  let done = 0;

  for (let i = 0; i < ips.length; i += CONCURRENT) {
    const batch = ips.slice(i, i + CONCURRENT);
    const batchResults = await Promise.all(batch.map(probeSamsungTV));
    results.push(...batchResults.filter(Boolean));
    done += batch.length;

    // Barra de progresso
    const pct = Math.round(done / ips.length * 100);
    const filled = Math.round(pct / 5);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    process.stdout.write(`\r  [${bar}] ${done}/${ips.length} IPs`);
  }
  process.stdout.write('\n');
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const net = getLocalNetwork();
  if (!net) {
    console.error('Erro: não foi possível detectar a rede local. Verifique a conexão Wi-Fi.');
    process.exit(1);
  }

  console.log(`\n  Flex TV — Descoberta de Samsung TVs`);
  console.log(`  IP local: ${net.myIp}`);
  console.log(`  Escaneando rede ${net.base}.0/24...\n`);

  const tvs = await scanRange(net.base);

  if (!tvs.length) {
    console.log('\n  Nenhuma Samsung TV encontrada na rede.');
    console.log('  Certifique-se de que as TVs estão ligadas e na mesma rede Wi-Fi.\n');
    return;
  }

  // Enriquece com MACs via ARP
  const arp = getArpTable();
  tvs.forEach(tv => { tv.mac = arp[tv.ip] || '—'; });

  // Tabela de resultado
  console.log(`\n  ${tvs.length} Samsung TV${tvs.length > 1 ? 's' : ''} encontrada${tvs.length > 1 ? 's' : ''}:\n`);
  console.log('  ' + '─'.repeat(82));
  console.log(`  ${'Nome'.padEnd(30)} ${'IP'.padEnd(16)} ${'MAC'.padEnd(20)} Modelo`);
  console.log('  ' + '─'.repeat(82));
  tvs.forEach(tv => {
    console.log(`  ${tv.name.slice(0, 29).padEnd(30)} ${tv.ip.padEnd(16)} ${tv.mac.padEnd(20)} ${tv.model}`);
  });
  console.log('  ' + '─'.repeat(82));

  // Salva JSON
  const outFile = path.join(__dirname, 'tvs-encontradas.json');
  fs.writeFileSync(outFile, JSON.stringify(tvs, null, 2), 'utf8');

  console.log(`\n  ✅ Resultado salvo em bridge/tvs-encontradas.json`);
  console.log(`  Próximo passo: no dashboard, clique em "Importar TVs" e selecione este arquivo.\n`);
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
