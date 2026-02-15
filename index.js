const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const unzipper = require("unzipper");
const httpProxy = require("http-proxy"); // 利用你装好的这个零件

const CONFIG = {
  UUID: process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913",
  PORT: parseInt(process.env.PORT) || 8080,
  XRAY_PORT: 3000, // 让 Xray 躲在 3000 端口，不跟网页抢 8080
  RAIL_DOMAIN: process.env.RAILWAY_STATIC_URL || "nodejs-railway-production-ad5e.up.railway.app",
  SUB_PATH: (process.env.SUB_PATH || "sub").replace(/^\/+/, ""),
  FILE_PATH: "./bin_core",
};

const proxy = httpProxy.createProxyServer({ ws: true });

if (!fs.existsSync(CONFIG.FILE_PATH)) fs.mkdirSync(CONFIG.FILE_PATH, { recursive: true });

async function boot() {
  const xrayZipUrl = `https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-linux-64.zip`;

  try {
    console.log("🚀 启动原生 IP 模式 (端口复用版)...");
    
    // 下载 Xray
    const response = await axios({ url: xrayZipUrl, method: 'GET', responseType: 'stream' });
    await response.data.pipe(unzipper.Extract({ path: CONFIG.FILE_PATH })).promise();
    
    const xrayPath = path.join(CONFIG.FILE_PATH, 'xray');
    if (fs.existsSync(xrayPath)) fs.chmodSync(xrayPath, 0o755);
    else {
        const bin = fs.readdirSync(CONFIG.FILE_PATH).find(f => f.toLowerCase().includes('xray'));
        fs.renameSync(path.join(CONFIG.FILE_PATH, bin), xrayPath);
        fs.chmodSync(xrayPath, 0o755);
    }

    // 生成配置：让 Xray 听 3000 端口
    const config = {
      log: { loglevel: "warning" },
      inbounds: [{
        port: CONFIG.XRAY_PORT,
        protocol: "vless",
        settings: { clients: [{ id: CONFIG.UUID, level: 0 }], decryption: "none" },
        streamSettings: { network: "ws", wsSettings: { path: "/speed" } }
      }],
      outbounds: [{ protocol: "freedom" }]
    };
    fs.writeFileSync(path.join(CONFIG.FILE_PATH, "config.json"), JSON.stringify(config, null, 2));
    
    // 启动 Xray
    spawn(xrayPath, ["-c", path.join(CONFIG.FILE_PATH, "config.json")], { stdio: 'inherit' });
    console.log(`[✓] Xray Core started on internal port ${CONFIG.XRAY_PORT}`);

  } catch (err) {
    console.error(`Boot Failed: ${err.message}`);
  }
}

// --- 核心技巧：端口复用 ---
// 当流量访问 /speed 时，转交给 Xray；访问其他时，显示网页
app.all("/speed*", (req, res) => {
  proxy.web(req, res, { target: `http://127.0.0.1:${CONFIG.XRAY_PORT}` });
});

// 首页
app.get("/", (req, res) => res.send(`Native IP Active: ${CONFIG.RAIL_DOMAIN}`));

// 订阅
app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  const vless = `vless://${CONFIG.UUID}@${CONFIG.RAIL_DOMAIN}:443?encryption=none&security=tls&sni=${CONFIG.RAIL_DOMAIN}&type=ws&path=%2Fspeed#Railway-Native`;
  res.send(Buffer.from(vless).toString("base64"));
});

boot();

// 处理 WebSocket 升级请求 (这是连上的关键)
const server = app.listen(CONFIG.PORT, "0.0.0.0");
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/speed')) {
    proxy.ws(req, socket, head, { target: `http://127.0.0.1:${CONFIG.XRAY_PORT}` });
  }
});
