# Flex TV Bridge — Agente de controle de energia

Este script roda no seu computador (dentro da rede da Grupo Flex) e permite ligar e desligar as Samsung Smart TVs remotamente pelo dashboard.

---

## Como funciona

```
Dashboard (celular/PC)
    ↓  WebSocket (nuvem)
Render: server/index.js
    ↓  WebSocket (nuvem)
bridge/agent.js  ← roda no seu PC
    ↓  rede local
Samsung TVs
```

---

## Instalação (única vez)

Abra o PowerShell dentro da pasta `bridge/`:

```powershell
cd "c:\Inteligência\projetos\flex-tv\bridge"
npm install
```

---

## Uso

Sempre que quiser controlar energia das TVs, rode:

```powershell
cd "c:\Inteligência\projetos\flex-tv\bridge"
node agent.js
```

Deixe o terminal aberto. Você verá:

```
[Bridge] Conectando a https://flex-tv.onrender.com…
[Bridge] ✅ Conectado ao servidor Flex TV
```

O ícone **Bridge** no dashboard ficará verde. Você já pode usar os botões "Ligar" e "Desligar".

---

## Configurar o servidor (opcional)

Se você mudou a URL do Render, defina antes de rodar:

```powershell
$env:FLEX_TV_SERVER = "https://sua-url.onrender.com"
node agent.js
```

---

## Configurar cada TV (única vez por TV)

### 1. Habilitar "Ligar pela rede" na Samsung

Na TV: **Configurações → Geral → Rede → Configurações de rede especialistas → Wake on LAN → Ativado**

O caminho exato varia por modelo. Procure por "Wake on LAN", "Power On with Mobile", ou "Ligar com dispositivo móvel".

### 2. Anotar o MAC e o IP da TV

Na TV: **Configurações → Geral → Rede → Status da rede**

- **Endereço MAC** — formato: `AA:BB:CC:DD:EE:FF`
- **Endereço IP** — formato: `192.168.x.x`

Dica: Configure IP fixo no roteador para cada TV (por MAC address) para que o IP não mude.

### 3. Inserir no Dashboard

No dashboard, clique no ícone ⚙ do card de cada TV → preencha MAC e IP → salvar.

---

## Primeira vez que desligar

Na primeira vez que o bridge tentar desligar uma TV via API Samsung (porta 8002), a TV exibirá na tela:

> **"Permitir conexão de FlexTV?"**

Use o controle remoto para selecionar **Permitir**. Isso é feito uma única vez por TV — depois o bridge conecta automaticamente.

---

## Resolução de problemas

| Problema | Causa | Solução |
|---|---|---|
| TV não liga | WoL não habilitado na TV | Ativar Wake on LAN nas configurações |
| TV não liga | TV completamente sem energia | WoL só funciona em standby (luz vermelha) |
| TV não desliga | Pop-up de permissão pendente | Aprovar "Permitir FlexTV" na tela da TV |
| TV não desliga | IP errado | Verificar IP em Configurações → Rede na TV |
| Bridge desconecta | PC em modo de suspensão | Desabilitar suspensão enquanto usar o bridge |
| "Bridge não conectado" no dashboard | agent.js não está rodando | Abrir o PowerShell e rodar `node agent.js` |
