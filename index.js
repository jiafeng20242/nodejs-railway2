const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const http = require("http");
const https = require("https");
const net = require("net");

const CONFIG = {
  UUID: process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913",
  PORT: parseInt(process.env.PORT) || 8080,
  XRAY_PORT: 3000,
  RAIL_DOMAIN: process.env.RAILWAY_STATIC_URL || "nodejs-railway-production-ad5e.up.railway.app",
  SUB_PATH: (process.env.SUB_PATH || "sub").replace(/^\/+/, ""),
  FILE_PATH: "./bin_core",
};

if (!fs.existsSync(CONFIG.FILE_PATH)) {
  fs.mkdirSync(CONFIG.FILE_PATH, { recursive: true });
}

const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

async function downloadAndExtract() {
  const xrayPath = path.join(CONFIG.FILE_PATH, "xray");
  
  if (fs.existsSync(xrayPath)) {
    console.log("[✓] Xray已存在");
    return xrayPath;
  }

  console.log("[下载] Xray 核心...");
  
  const url = "https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-linux-64.tar.gz";
  
  try {
    const response = await axios({
      url: url,
      method: "GET",
      responseType: "stream",
      timeout: 30000,
      httpAgent: httpAgent,
      httpsAgent: httpsAgent
    });

    const tarPath = path.join(CONFIG.FILE_PATH, "xray.tar.gz");
    
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(tarPath);
      response.data.pipe(stream);
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    try {
      execSync(`tar -xzf ${tarPath} -C ${CONFIG.FILE_PATH}`, { stdio: 'pipe' });
      fs.unlinkSync(tarPath);
    } catch (err) {
      const tar = require('tar');
      await tar.x({
        file: tarPath,
        cwd: CONFIG.FILE_PATH
      });
      fs.unlinkSync(tarPath);
    }

    fs.chmodSync(xrayPath, 0o755);
    console.log("[✓] Xray解压完成");
    return xrayPath;

  } catch (err) {
    console.error(`[错误] 下载失败: ${err.message}`);
    throw err;
  }
}

async function boot() {
  try {
    console.log("[启动] Railway 修正版 (同端口 WebSocket)...");
    
    const xrayPath = await downloadAndExtract();

    // 【修正】Xray 监听同一端口的不同路径
    const config = {
      log: { loglevel: "error" },
      
      inbounds: [
        {
          port: CONFIG.XRAY_PORT,
          listen: "127.0.0.1",  // 只监听 localhost
          protocol: "vless",
          settings: {
            clients: [
              {
                id: CONFIG.UUID,
                flow: "xtls-rprx-vision",
                level: 0
              }
            ],
            decryption: "none"
          },
          streamSettings: {
            network: "ws",
            wsSettings: {
              path: "/xray",
              connectionReuse: true,
              headers: {
                "User-Agent": "Mozilla/5.0"
              }
            },
            security: "none"
          },
          sniffing: {
            enabled: true,
            destOverride: ["http", "tls", "quic"]
          }
        }
      ],

      outbounds: [
        {
          protocol: "freedom",
          tag: "direct",
          settings: {
            domainStrategy: "AsIs"
          }
        },
        {
          protocol: "blackhole",
          tag: "block"
        }
      ],

      routing: {
        rules: [
          {
            type: "field",
            outboundTag: "direct"
          }
        ]
      },

      policy: {
        levels: {
          0: {
            handshake: 4,
            connIdle: 300,
            uplinkOnly: 2,
            downlinkOnly: 5,
            bufferSize: 10240,
            statsUserUplink: false,
            statsUserDownlink: false
          }
        },
        system: {
          statsInboundUplink: false,
          statsInboundDownlink: false,
          statsOutboundUplink: false,
          statsOutboundDownlink: false
        }
      }
    };

    fs.writeFileSync(
      path.join(CONFIG.FILE_PATH, "config.json"),
      JSON.stringify(config, null, 2)
    );

    const xray = spawn(xrayPath, ["-c", path.join(CONFIG.FILE_PATH, "config.json")], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    xray.on("error", (err) => {
      console.error(`[Xray] 启动错误: ${err.message}`);
    });

    xray.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg && msg.includes("error:")) {
        console.error(`[Xray] ${msg}`);
      }
    });

    xray.on("exit", (code, signal) => {
      console.log(`[警告] Xray已退出 (code:${code}, signal:${signal})`);
      console.log("[重启] 30秒后重新启动...");
      setTimeout(boot, 30000);
    });

    console.log("[✓] Xray 核心启动成功");

  } catch (err) {
    console.error(`[启动失败] ${err.message}`);
    console.log("[重试] 10秒后重新尝试...");
    setTimeout(boot, 10000);
  }
}

// ===== Express 路由 =====

app.get("/", (req, res) => {
  res.send("Railway WebSocket Proxy - Ready");
});

app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  // 【关键】订阅链接指向 Railway Domain + /xray 路径
  const vless = `vless://${CONFIG.UUID}@${CONFIG.RAIL_DOMAIN}:443?encryption=none&flow=xtls-rprx-vision&security=tls&sni=${CONFIG.RAIL_DOMAIN}&type=ws&path=%2Fxray&host=${CONFIG.RAIL_DOMAIN}#Railway-WS-Fixed`;
  
  res.type("text/plain");
  res.send(Buffer.from(vless).toString("base64"));
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "online",
    mode: "websocket",
    uptime: process.uptime()
  });
});

boot();

// 【修正】创建单一 HTTP 服务器处理所有流量
const server = http.createServer(app);

// 【关键修正】upgrade 事件处理 - 在同一端口上
server.on("upgrade", (req, socket, head) => {
  // 只有 /xray 路径的 WebSocket upgrade 请求
  if (req.url === "/xray" && req.headers.upgrade?.toLowerCase() === "websocket") {
    
    console.log("[WebSocket] 新连接来自", req.socket.remoteAddress);
    
    // 转发到本地 Xray 实例
    const target = net.createConnection({
      port: CONFIG.XRAY_PORT,
      host: "127.0.0.1"
    });

    target.on("connect", () => {
      console.log("[WebSocket] 已连接到 Xray");
      
      // 发送 WebSocket upgrade 响应
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n" +
        "\r\n"
      );
      
      // 双向管道转发
      socket.pipe(target);
      target.pipe(socket);
    });

    target.on("error", (err) => {
      console.error(`[WebSocket] Xray 连接错误: ${err.message}`);
      socket.destroy();
    });

    socket.on("error", (err) => {
      console.error(`[WebSocket] Socket 错误: ${err.message}`);
      target.destroy();
    });

    socket.on("close", () => {
      console.log("[WebSocket] 连接已关闭");
      target.destroy();
    });

    // 转发初始数据
    if (head && head.length > 0) {
      target.write(head);
    }

  } else {
    // 其他升级请求直接拒绝
    socket.end();
  }
});

// 【关键】监听单一端口 - 这是 Railway 要求的
server.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`\n[✓] Railway WebSocket 服务已启动`);
  console.log(`    HTTP 端口: 0.0.0.0:${CONFIG.PORT}`);
  console.log(`    Xray 本地: 127.0.0.1:${CONFIG.XRAY_PORT}`);
  console.log(`    Railway Domain: ${CONFIG.RAIL_DOMAIN}`);
  console.log(`    WebSocket 路径: /xray`);
  console.log(`    订阅地址: https://${CONFIG.RAIL_DOMAIN}/${CONFIG.SUB_PATH}`);
  console.log(`    健康检查: https://${CONFIG.RAIL_DOMAIN}/health\n`);
});

// 优雅关闭
process.on("SIGTERM", () => {
  console.log("[关闭] 收到 SIGTERM 信号");
  server.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[关闭] 收到 SIGINT 信号");
  server.close();
  process.exit(0);
});
