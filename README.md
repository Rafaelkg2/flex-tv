# Flex TV — Digital Signage Interno

Sistema de transmissão de conteúdo para Smart TVs da Grupo Flex.
Controle em tempo real via celular ou computador, sem mexer nas TVs.

---

## Funcionalidades

- Enviar URLs, dashboards, YouTube, Google Slides, vídeos MP4 e mensagens HTML para todas as TVs simultaneamente
- Countdown com timer regressivo
- Streaming ao vivo (câmera + OBS via Mediamtx/HLS)
- Biblioteca de conteúdos salvos
- Dashboard responsivo (funciona no celular)
- TVs reconectam automaticamente em caso de queda de rede

---

## Estrutura

```
projetos/flex-tv/
├── server/index.js          # Backend Node.js + Socket.io
├── public/
│   ├── player/index.html    # Página que roda nas Smart TVs
│   └── dashboard/index.html # Painel de controle do operador
├── mediamtx/README.md       # Guia de streaming ao vivo
├── package.json
└── render.yaml              # Config de deploy no Render
```

---

## Setup rápido

### 1. Deploy no Render (uma única vez)

1. Crie um repositório no GitHub: `Rafaelkg2/flex-tv`
2. Copie este projeto para o repositório
3. Acesse [render.com](https://render.com) → **New Web Service** → conecte o repositório
4. Build command: `npm install`
5. Start command: `node server/index.js`
6. Variável de ambiente: `DASHBOARD_PASSWORD` = sua senha
7. Deploy — URL gerada: `https://flex-tv.onrender.com`

### 2. Configurar cada TV (uma única vez por TV)

1. Abra o browser da Smart TV
2. Acesse: `https://flex-tv.onrender.com/player`
3. Coloque em fullscreen (menu da TV ou tecla dedicada)
4. A tela de standby confirma que a TV está conectada ✅

### 3. Usar o painel de controle

1. Acesse no celular ou PC: `https://flex-tv.onrender.com/dashboard`
2. Faça login com a senha configurada
3. Aba **TVs**: veja quais TVs estão online e envie conteúdo
4. Aba **Conteúdo**: biblioteca de itens salvos
5. Aba **Ao Vivo**: streaming via OBS + Mediamtx

---

## Streaming ao vivo

Consulte [`mediamtx/README.md`](mediamtx/README.md) para o guia completo de setup do OBS e Mediamtx.

---

## Desenvolvimento local

```bash
npm install
node server/index.js
# Acesse: http://localhost:3000/dashboard
```

Senha padrão (sem variável de ambiente): `flex2024`

---

## Variáveis de ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `DASHBOARD_PASSWORD` | Senha de acesso ao dashboard | `flex2024` |
| `PORT` | Porta do servidor | `3000` |
