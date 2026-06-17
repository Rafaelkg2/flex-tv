# Mediamtx — Guia de uso para streaming ao vivo

O Mediamtx converte o stream do OBS (RTMP) em HLS, que as Smart TVs conseguem reproduzir nativamente — sem nenhum plugin.

---

## 1. Download

1. Acesse: https://github.com/bluenviron/mediamtx/releases/latest
2. Baixe o arquivo: **`mediamtx_vX.X.X_windows_amd64.zip`**
3. Extraia o conteúdo em uma pasta de fácil acesso, por exemplo:
   ```
   C:\mediamtx\
   ```

---

## 2. Executar

Abra o Prompt de Comando ou PowerShell e execute:

```
cd C:\mediamtx
mediamtx.exe
```

Você verá mensagens parecidas com:

```
2024/06/17 10:30:00 INF MediaMTX v1.x.x
2024/06/17 10:30:00 INF [RTMP] listener opened on :1935
2024/06/17 10:30:00 INF [HLS]  listener opened on :8888
```

Mantenha essa janela aberta durante toda a transmissão.

---

## 3. Configurar o OBS

1. No OBS, vá em **Configurações → Transmissão**
2. Serviço: **Custom...**
3. Servidor: `rtmp://localhost:1935/live/main`
4. Chave de transmissão: (deixe em branco ou coloque qualquer texto)
5. Clique **OK** e depois **Iniciar transmissão** no OBS

---

## 4. URL HLS para colar no Dashboard

Você vai precisar do IP local do seu laptop (não o IP público, e não `localhost`).

**Como descobrir o IP local:**

```
ipconfig
```

Procure a linha **"Endereço IPv4"** na seção da sua rede Wi-Fi. Exemplo: `192.168.1.42`

A URL HLS será:

```
http://192.168.1.42:8888/live/main/index.m3u8
```

Cole essa URL na aba **Ao Vivo** do Dashboard Flex TV e clique em **Iniciar transmissão ao vivo**.

---

## 5. Importante

- O laptop com o Mediamtx e as Smart TVs precisam estar **na mesma rede Wi-Fi** da Grupo Flex.
- A transmissão só funciona enquanto o `mediamtx.exe` e o OBS estiverem rodando no laptop.
- Ao encerrar a transmissão no Dashboard, as TVs voltam ao standby automaticamente.
- Para testar a URL antes de enviar para as TVs, cole-a num navegador de PC — o VLC ou o Chrome com extensão HLS também funcionam.

---

## 6. Codec recomendado no OBS

- Vídeo: **H.264** (x264 ou hardware NVENC/AMF)
- Áudio: **AAC** (128 kbps ou 192 kbps)
- Resolução: **1920×1080** (as TVs mostram em fullscreen)
- FPS: **30** (estável e compatível)

---

## Estrutura de portas

| Serviço      | Porta | Protocolo |
|--------------|-------|-----------|
| OBS → Mediamtx | 1935 | RTMP (entrada) |
| TVs → Mediamtx | 8888 | HTTP/HLS  (saída) |
| Flex TV Server | 3000 | HTTP/WebSocket |
