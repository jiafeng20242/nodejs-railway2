const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const unzipper = require("unzipper");
const http = require("http");

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
    console.log("[INFO] 🚀 2026 极致纯净版启动...");
    
    const response = await axios({ url: xrayZipUrl, method: 'GET', responseType: 'stream' });
    await response.data.pipe(unzipper.Extract({ path: CONFIG.FILE_PATH })).promise();
    
    const xrayPath = path.join(CONFIG.FILE_PATH, 'xray');
    if (fs.existsSync(xrayPath)) fs.chmodSync(xrayPath, 0o755);

    // 【关键优化】生成极简且高性能的配置
    const config = {
      log: { loglevel: "error" }, // 停止刷日志，保护磁盘IO，提升隐蔽性
      inbounds: [{
        port: CONFIG.XRAY_PORT,
        protocol: "vless",
        settings: { clients: [{ id: CONFIG.UUID, level: 0 }], decryption: "none" },
        streamSettings: { 
          network: "ws", 
          wsSettings: { path: "/speed" },
          sockopt: { tcpFastOpen: true } // 开启 TFO 提速
        }
      }],
      outbounds: [
        {
          protocol: "freedom",
          settings: { domainStrategy: "UseIPv4" }, // 强制 IPv4 绕过污染严重的 IPv6
          streamSettings: { sockopt: { tcpFastOpen: true } }
        },
        { protocol: "blackhole", tag: "block" }
      ]
    };
    fs.writeFileSync(path.join(CONFIG.FILE_PATH, "config.json"), JSON.stringify(config, null, 2));
    
    spawn(xrayPath, ["-c", path.join(CONFIG.FILE_PATH, "config.json")], { stdio: 'inherit' });
    console.log(`[✓] Core started. Port: ${CONFIG.XRAY_PORT}`);

  } catch (err) {
    console.error(`[ERROR] Boot Failed: ${err.message}`);
  }
}

app.get("/", (req, res) => res.send(`Native Status: Active`));
app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  const vless = `vless://${CONFIG.UUID}@${CONFIG.RAIL_DOMAIN}:443?encryption=none&security=tls&sni=${CONFIG.RAIL_DOMAIN}&type=ws&path=%2Fspeed#Railway-Native-2026`;
  res.send(Buffer.from(vless).toString("base64"));
});

boot();

const server = http.createServer(app);
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/speed')) {
    const targetRequest = http.request({
      port: CONFIG.XRAY_PORT,
      host: '127.0.0.1',
      headers: req.headers,
      method: req.method,
      path: req.url
    });
    targetRequest.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.keys(proxyRes.headers).map(h => `${h}: ${proxyRes.headers[h]}`).join('\r\n') + '\r\n\r\n');
      proxySocket.pipe(socket).pipe(proxySocket);
    });
    targetRequest.end();
  }
});

server.listen(CONFIG.PORT);
