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
    console.log("[INFO] 🚀 2026 XHTTP 最终修正版启动...");
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
          xhttpSettings: { path: "/speed" } // XHTTP 路径
        }
      }],
      outbounds: [{ protocol: "freedom" }]
    };
    fs.writeFileSync(path.join(CONFIG.FILE_PATH, "config.json"), JSON.stringify(config, null, 2));
    spawn(xrayPath, ["-c", path.join(CONFIG.FILE_PATH, "config.json")], { stdio: 'inherit' });
    console.log(`[✓] Xray Engine (XHTTP-Pure) 已就绪`);
  } catch (err) { console.error(`Boot Failed: ${err.message}`); }
}

// 1. 首页路由
app.get("/", (req, res) => res.send("Native Mode Online - XHTTP Fixed"));

// 2. 订阅路由
app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  const vless = `vless://${CONFIG.UUID}@${CONFIG.RAIL_DOMAIN}:443?encryption=none&flow=xtls-rprx-vision&security=tls&sni=${CONFIG.RAIL_DOMAIN}&type=xhttp&path=%2Fspeed#Railway-Native-Fixed`;
  res.send(Buffer.from(vless).toString("base64"));
});

// 【核心修复】将 XHTTP 流量转发逻辑移入 Express 路由！
// 这样就不会被 Express 当作 404 拦截了
app.use('/speed', (req, res) => {
    const options = {
        hostname: '127.0.0.1',
        port: CONFIG.XRAY_PORT,
        path: req.originalUrl || req.url,
        method: req.method,
        headers: req.headers
    };
    
    // 建立到 Xray 端口的代理请求
    const proxy = http.request(options, (targetRes) => {
        res.writeHead(targetRes.statusCode, targetRes.headers);
        targetRes.pipe(res);
    });

    proxy.on('error', (err) => {
        console.error("Proxy Error:", err.message);
        res.end();
    });

    // 将客户端的数据导给 Xray
    req.pipe(proxy);
});

boot();

const server = http.createServer(app);

// 保持 Upgrade 监听以兼容部分旧逻辑（可选，加上更稳）
server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/speed')) {
        const target = net.connect(CONFIG.XRAY_PORT, '127.0.0.1', () => {
            target.write(head);
            socket.pipe(target).pipe(socket);
        });
        target.on('error', () => socket.end());
    }
});

server.listen(CONFIG.PORT);
