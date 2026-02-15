const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const unzipper = require("unzipper");
const http = require("http");
const net = require("net");

const CONFIG = {
  UUID: process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913",
  PORT: parseInt(process.env.PORT) || 8080,
  XRAY_PORT: 3000, 
  RAIL_DOMAIN: process.env.RAILWAY_STATIC_URL || "nodejs-railway-production-ad5e.up.railway.app",
  SUB_PATH: (process.env.SUB_PATH || "sub").replace(/^\/+/, ""),
  FILE_PATH: "./bin_core",
};

if (!fs.existsSync(CONFIG.FILE_PATH)) fs.mkdirSync(CONFIG.FILE_PATH, { recursive: true });

async function boot() {
  const xrayZipUrl = `https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-linux-64.zip`;

  try {
    console.log("[INFO] 🚀 2026 极致纯净原生IP模式 (XHTTP + Vision)...");
    const response = await axios({ url: xrayZipUrl, method: 'GET', responseType: 'stream' });
    await response.data.pipe(unzipper.Extract({ path: CONFIG.FILE_PATH })).promise();
    const xrayPath = path.join(CONFIG.FILE_PATH, 'xray');
    
    if (fs.existsSync(xrayPath)) fs.chmodSync(xrayPath, 0o755);
    else {
        const bin = fs.readdirSync(CONFIG.FILE_PATH).find(f => f.toLowerCase().includes('xray'));
        if (bin) { fs.renameSync(path.join(CONFIG.FILE_PATH, bin), xrayPath); fs.chmodSync(xrayPath, 0o755); }
    }

    // 【核心修正】改用 XHTTP 协议并添加 Flow，彻底消除日志中的所有警告
    const config = {
      log: { loglevel: "error" },
      inbounds: [{
        port: CONFIG.XRAY_PORT,
        protocol: "vless",
        settings: { 
          clients: [{ id: CONFIG.UUID, flow: "xtls-rprx-vision", level: 0 }], 
          decryption: "none" 
        },
        streamSettings: {
          network: "xhttp",
          xhttpSettings: { mode: "speed", path: "/xhttp" }
        }
      }],
      outbounds: [{ protocol: "freedom" }]
    };
    fs.writeFileSync(path.join(CONFIG.FILE_PATH, "config.json"), JSON.stringify(config, null, 2));
    spawn(xrayPath, ["-c", path.join(CONFIG.FILE_PATH, "config.json")], { stdio: 'inherit' });
    console.log(`[✓] Xray Engine (XHTTP) Ready.`);
  } catch (err) { console.error(`Boot Failed: ${err.message}`); }
}

app.get("/", (req, res) => res.send("Native Mode Online (2026)"));
app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  // 节点信息同步更新为 xhttp + vision 模式
  const vless = `vless://${CONFIG.UUID}@${CONFIG.RAIL_DOMAIN}:443?encryption=none&flow=xtls-rprx-vision&security=tls&sni=${CONFIG.RAIL_DOMAIN}&type=xhttp&mode=speed&path=%2Fxhttp#Railway-Pure-XHTTP`;
  res.send(Buffer.from(vless).toString("base64"));
});

boot();

const server = http.createServer(app);
// XHTTP 流量转发逻辑，直接打通底层管道
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/xhttp')) {
    const target = net.connect(CONFIG.XRAY_PORT, '127.0.0.1', () => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      target.write(head);
      socket.pipe(target).pipe(socket);
    });
    target.on('error', () => socket.end());
  }
});

server.listen(CONFIG.PORT);
