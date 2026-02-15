const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const unzipper = require("unzipper");
const http = require("http");
const net = require("net");

const CONFIG = {
  UUID: process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913",
  PORT: parseInt(process.env.PORT) || 8080,
  XRAY_PORT: 3000, 
  RAIL_DOMAIN: process.env.RAILWAY_STATIC_URL || "nodejs-railway-production-fc83.up.railway.app",
  SUB_PATH: (process.env.SUB_PATH || "sub").replace(/^\/+/, ""),
  FILE_PATH: "./bin_v184_final",
};

if (!fs.existsSync(CONFIG.FILE_PATH)) fs.mkdirSync(CONFIG.FILE_PATH, { recursive: true });

// 清理旧进程（避免端口占用）
function cleanup() {
  try {
    execSync("pkill -9 xray 2>/dev/null || true", { stdio: 'ignore' });
  } catch (e) {}
}

async function boot() {
  const xrayZipUrl = "https://github.com/XTLS/Xray-core/releases/download/v1.8.4/Xray-linux-64.zip";
  
  try {
    console.log("[INFO] 🚀 正在部署全自动适配版 v1.8.4...");
    
    cleanup(); // 启动前清理
    
    const xrayPath = path.join(CONFIG.FILE_PATH, 'xray');
    
    // 只在首次下载
    if (!fs.existsSync(xrayPath)) {
      console.log("[下载] Xray v1.8.4...");
      const response = await axios({ url: xrayZipUrl, method: 'GET', responseType: 'stream' });
      await response.data.pipe(unzipper.Extract({ path: CONFIG.FILE_PATH })).promise();
      
      const bin = fs.readdirSync(CONFIG.FILE_PATH).find(f => f.toLowerCase().includes('xray'));
      if (bin && bin !== 'xray') {
        fs.renameSync(path.join(CONFIG.FILE_PATH, bin), xrayPath);
      }
      fs.chmodSync(xrayPath, 0o755);
      console.log("[✓] 下载完成");
    } else {
      console.log("[✓] Xray 已存在");
    }

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
    
    const xray = spawn(xrayPath, ["-c", path.join(CONFIG.FILE_PATH, "config.json")], { stdio: 'inherit' });
    
    xray.on("exit", (code) => {
      console.error(`[错误] Xray 退出 (${code})，30秒后重启...`);
      setTimeout(boot, 30000);
    });
    
    console.log("[✓] Xray 核心运行中...");
  } catch (err) {
    console.error(`[ERROR] 启动失败: ${err.message}`);
    setTimeout(boot, 10000);
  }
}

app.get("/", (req, res) => {
  res.send(`
    <h1>🚀 Railway Xray Proxy</h1>
    <p>Version: v1.8.4 Stable</p>
    <p>订阅: <code>https://${CONFIG.RAIL_DOMAIN}/${CONFIG.SUB_PATH}</code></p>
  `);
});

app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  const vless = `vless://${CONFIG.UUID}@${CONFIG.RAIL_DOMAIN}:443?encryption=none&security=tls&sni=${CONFIG.RAIL_DOMAIN}&type=ws&path=%2Fxray#Railway-Auto-Node`;
  res.send(Buffer.from(vless).toString("base64"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    version: "v1.8.4",
    domain: CONFIG.RAIL_DOMAIN,
    uptime: process.uptime()
  });
});

boot();

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/xray') {
    const target = net.connect(CONFIG.XRAY_PORT, '127.0.0.1', () => {
      let headerStr = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (let k in req.headers) {
        headerStr += `${k}: ${req.headers[k]}\r\n`;
      }
      headerStr += '\r\n';
      
      target.write(headerStr);
      target.write(head);
      
      socket.pipe(target);
      target.pipe(socket);
    });
    
    target.on('error', () => socket.end());
    socket.on('error', () => target.end());
  } else {
    socket.end();
  }
});

server.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`[✓] 服务已启动，监听端口: ${CONFIG.PORT}`);
  console.log(`[✓] 订阅地址: https://${CONFIG.RAIL_DOMAIN}/${CONFIG.SUB_PATH}`);
});

process.on("SIGTERM", () => {
  console.log("[关闭] 收到关闭信号");
  cleanup();
  process.exit(0);
});
