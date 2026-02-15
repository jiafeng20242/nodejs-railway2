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
    console.log("[INFO] 🚀 2026 XHTTP 流量穿透版启动...");
    const response = await axios({ url: xrayZipUrl, method: 'GET', responseType: 'stream' });
    await response.data.pipe(unzipper.Extract({ path: CONFIG.FILE_PATH })).promise();
    const xrayPath = path.join(CONFIG.FILE_PATH, 'xray');
    if (fs.existsSync(xrayPath)) fs.chmodSync(xrayPath, 0o755);
    else {
        const bin = fs.readdirSync(CONFIG.FILE_PATH).find(f => f.toLowerCase().includes('xray'));
        if (bin) { fs.renameSync(path.join(CONFIG.FILE_PATH, bin), xrayPath); fs.chmodSync(xrayPath, 0o755); }
    }

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
          xhttpSettings: { path: "/speed" }
        }
      }],
      outbounds: [{ protocol: "freedom" }]
    };
    fs.writeFileSync(path.join(CONFIG.FILE_PATH, "config.json"), JSON.stringify(config, null, 2));
    spawn(xrayPath, ["-c", path.join(CONFIG.FILE_PATH, "config.json")], { stdio: 'inherit' });
    console.log(`[✓] Xray Engine (XHTTP-Pure) 已就绪`);
  } catch (err) { console.error(`Boot Failed: ${err.message}`); }
}

app.get("/", (req, res) => res.send("Native Mode Online - XHTTP Ready"));
app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  const vless = `vless://${CONFIG.UUID}@${CONFIG.RAIL_DOMAIN}:443?encryption=none&flow=xtls-rprx-vision&security=tls&sni=${CONFIG.RAIL_DOMAIN}&type=xhttp&path=%2Fspeed#Railway-Native-XHTTP`;
  res.send(Buffer.from(vless).toString("base64"));
});

boot();

const server = http.createServer(app);

// 【核心修正 1】处理 WebSocket 升级 (兼容旧设备)
server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/speed')) {
        const target = net.connect(CONFIG.XRAY_PORT, '127.0.0.1', () => {
            target.write(head);
            socket.pipe(target).pipe(socket);
        });
        target.on('error', () => socket.end());
    }
});

// 【核心修正 2】新增：处理 XHTTP 普通请求转发！
// 这就是你之前 -1 的原因：XHTTP 走的是 request 事件，不是 upgrade 事件！
server.on('request', (req, res) => {
    if (req.url.startsWith('/speed')) {
        // 这是一个 XHTTP 流量，需要代理到内部 Xray 端口
        const options = {
            hostname: '127.0.0.1',
            port: CONFIG.XRAY_PORT,
            path: req.url,
            method: req.method,
            headers: req.headers
        };
        
        const proxy = http.request(options, (targetRes) => {
            res.writeHead(targetRes.statusCode, targetRes.headers);
            targetRes.pipe(res);
        });
        
        proxy.on('error', (err) => res.end());
        req.pipe(proxy);
    }
});

server.listen(CONFIG.PORT);
