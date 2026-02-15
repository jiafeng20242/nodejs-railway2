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
    console.log("[INFO] 🚀 正在启动经典 WebSocket 修复版...");
    
    // 下载与解压
    const response = await axios({ url: xrayZipUrl, method: 'GET', responseType: 'stream' });
    await response.data.pipe(unzipper.Extract({ path: CONFIG.FILE_PATH })).promise();
    
    const xrayPath = path.join(CONFIG.FILE_PATH, 'xray');
    if (fs.existsSync(xrayPath)) fs.chmodSync(xrayPath, 0o755);
    else {
        const bin = fs.readdirSync(CONFIG.FILE_PATH).find(f => f.toLowerCase().includes('xray'));
        if (bin) { fs.renameSync(path.join(CONFIG.FILE_PATH, bin), xrayPath); fs.chmodSync(xrayPath, 0o755); }
    }

    // 【Xray 配置】标准 VLESS + WebSocket
    const config = {
      log: { loglevel: "error" },
      inbounds: [{
        port: CONFIG.XRAY_PORT,
        protocol: "vless",
        settings: { 
          clients: [{ id: CONFIG.UUID, level: 0 }], 
          decryption: "none" 
        },
        streamSettings: {
          network: "ws",
          wsSettings: { path: "/xray" }
        }
      }],
      outbounds: [{ protocol: "freedom" }]
    };
    
    fs.writeFileSync(path.join(CONFIG.FILE_PATH, "config.json"), JSON.stringify(config, null, 2));
    spawn(xrayPath, ["-c", path.join(CONFIG.FILE_PATH, "config.json")], { stdio: 'inherit' });
    console.log(`[✓] Xray 核心已启动 (Port ${CONFIG.XRAY_PORT})`);

  } catch (err) { console.error(`Boot Failed: ${err.message}`); }
}

app.get("/", (req, res) => res.send("Classic Mode Fixed"));

// 订阅链接
app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  const vless = `vless://${CONFIG.UUID}@${CONFIG.RAIL_DOMAIN}:443?encryption=none&security=tls&sni=${CONFIG.RAIL_DOMAIN}&type=ws&path=%2Fxray#Railway-Classic-Fixed`;
  res.send(Buffer.from(vless).toString("base64"));
});

boot();

const server = http.createServer(app);

// 【核心修复：透明转发逻辑】
server.on('upgrade', (req, socket, head) => {
    if (req.url === '/xray') {
        const target = net.connect(CONFIG.XRAY_PORT, '127.0.0.1', () => {
            // 1. 我们不再伪造 101 响应！
            // 2. 我们把 HTTP 握手头重建，发给 Xray，让 Xray 自己去处理握手
            const headers = [
                `${req.method} ${req.url} HTTP/1.1`,
                `Host: 127.0.0.1:${CONFIG.XRAY_PORT}`,
                `Upgrade: websocket`,
                `Connection: Upgrade`,
                // 必须保留客户端的 Key，否则 Xray 无法验证
                `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`, 
                `Sec-WebSocket-Version: ${req.headers['sec-websocket-version']}`,
                `\r\n`
            ].join('\r\n');

            target.write(headers);
            target.write(head);
            
            // 3. 建立管道：Xray 回复的真实 101 会通过这就传回给客户端
            socket.pipe(target);
            target.pipe(socket);
        });

        target.on('error', (err) => {
            console.error("Xray Connect Error:", err.message);
            socket.end();
        });
    } else {
        socket.end();
    }
});

server.listen(CONFIG.PORT);
