const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const unzipper = require("unzipper");

const CONFIG = {
  UUID: process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913",
  PORT: parseInt(process.env.PORT) || 8080,
  XRAY_PORT: 3000,
  
  // Railway TCP Proxy 端点（自动设置）
  TCP_DOMAIN: process.env.RAILWAY_TCP_PROXY_DOMAIN || "",
  TCP_PORT: parseInt(process.env.RAILWAY_TCP_PROXY_PORT) || 0,
  
  HTTP_DOMAIN: process.env.RAILWAY_STATIC_URL || "",
  FILE_PATH: "./bin_core",
};

if (!fs.existsSync(CONFIG.FILE_PATH)) {
  fs.mkdirSync(CONFIG.FILE_PATH, { recursive: true });
}

async function boot() {
  const xrayZipUrl = "https://github.com/XTLS/Xray-core/releases/download/v26.2.6/Xray-linux-64.zip";

  try {
    console.log("\n========================================");
    console.log("🚀 Railway 原生 IP 代理 - 纯 TCP 模式");
    console.log("========================================\n");
    
    const xrayPath = path.join(CONFIG.FILE_PATH, "xray");
    
    // 下载 Xray
    if (!fs.existsSync(xrayPath)) {
      console.log("[下载] Xray 核心...");
      const response = await axios({
        url: xrayZipUrl,
        method: "GET",
        responseType: "stream",
        timeout: 60000
      });
      
      await response.data.pipe(unzipper.Extract({ path: CONFIG.FILE_PATH })).promise();
      
      // 查找并重命名 xray 二进制文件
      const files = fs.readdirSync(CONFIG.FILE_PATH);
      const xrayBin = files.find(f => 
        f.toLowerCase().includes("xray") && 
        !f.includes(".") && 
        !f.includes("geoip") && 
        !f.includes("geosite")
      );
      
      if (xrayBin && xrayBin !== "xray") {
        fs.renameSync(
          path.join(CONFIG.FILE_PATH, xrayBin),
          xrayPath
        );
      }
      
      if (fs.existsSync(xrayPath)) {
        fs.chmodSync(xrayPath, 0o755);
        console.log("[✓] Xray 下载完成\n");
      } else {
        throw new Error("Xray 二进制文件未找到");
      }
    } else {
      console.log("[✓] Xray 已存在\n");
    }

    // 【最简配置】VLESS + TCP（无 WebSocket，无 XHTTP，无 TLS）
    const config = {
      log: {
        loglevel: "warning"
      },
      
      inbounds: [{
        port: CONFIG.XRAY_PORT,
        listen: "0.0.0.0",
        protocol: "vless",
        settings: {
          clients: [{
            id: CONFIG.UUID,
            level: 0
          }],
          decryption: "none"
        },
        streamSettings: {
          network: "tcp",
          security: "none"
        },
        sniffing: {
          enabled: true,
          destOverride: ["http", "tls"]
        }
      }],

      outbounds: [{
        protocol: "freedom",
        settings: {
          domainStrategy: "UseIP"
        }
      }]
    };

    fs.writeFileSync(
      path.join(CONFIG.FILE_PATH, "config.json"),
      JSON.stringify(config, null, 2)
    );

    console.log("[配置] VLESS + TCP（无加密，直连模式）");
    console.log("[监听] 0.0.0.0:" + CONFIG.XRAY_PORT + "\n");

    // 启动 Xray
    const xray = spawn(xrayPath, [
      "-c", 
      path.join(CONFIG.FILE_PATH, "config.json")
    ], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    xray.stdout.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[Xray] ${msg}`);
    });

    xray.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes("deprecated") && !msg.includes("Warning")) {
        console.error(`[Xray] ${msg}`);
      }
    });

    xray.on("exit", (code) => {
      console.error(`\n[错误] Xray 退出 (code ${code})`);
      console.log("[重启] 30秒后重新启动...\n");
      setTimeout(boot, 30000);
    });

    console.log("[✓] Xray 启动成功\n");

  } catch (err) {
    console.error(`[启动失败] ${err.message}`);
    console.log("[重试] 10秒后重新尝试...\n");
    setTimeout(boot, 10000);
  }
}

// HTTP 服务器（仅用于订阅）
const app = express();

app.get("/", (req, res) => {
  if (!CONFIG.TCP_DOMAIN || !CONFIG.TCP_PORT) {
    return res.send(`
      <h1>⚠️ 配置错误</h1>
      <p><strong>Railway TCP Proxy 未启用！</strong></p>
      <h3>请按以下步骤操作：</h3>
      <ol>
        <li>进入 Railway 项目</li>
        <li>Service → Settings → Networking</li>
        <li>点击 TCP Proxy</li>
        <li>输入端口：<code>3000</code></li>
        <li>点击 Enable</li>
        <li>重新部署</li>
      </ol>
    `);
  }

  res.send(`
    <h1>🚀 Railway 原生 IP 代理</h1>
    <h2>VLESS + TCP 直连模式</h2>
    <p><strong>订阅地址：</strong></p>
    <p><code>https://${CONFIG.HTTP_DOMAIN}/sub</code></p>
    <hr>
    <p><strong>TCP 端点（原生 IP）：</strong></p>
    <p><code>${CONFIG.TCP_DOMAIN}:${CONFIG.TCP_PORT}</code></p>
    <p><em>✅ 不走 Cloudflare CDN</em></p>
    <p><em>✅ 美国家庭宽带级纯净 IP</em></p>
    <p><em>✅ 无 WebSocket / XHTTP 警告</em></p>
  `);
});

app.get("/sub", (req, res) => {
  if (!CONFIG.TCP_DOMAIN || !CONFIG.TCP_PORT) {
    return res.status(500).send("错误：未配置 TCP Proxy！请在 Railway 后台启用。");
  }

  // VLESS + TCP 订阅链接
  const vless = `vless://${CONFIG.UUID}@${CONFIG.TCP_DOMAIN}:${CONFIG.TCP_PORT}?` +
    `encryption=none&` +
    `security=none&` +
    `type=tcp&` +
    `#Railway-Native-IP`;
  
  res.type("text/plain");
  res.send(Buffer.from(vless).toString("base64"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    protocol: "VLESS + TCP",
    mode: "direct",
    native_ip: true,
    tcp_endpoint: `${CONFIG.TCP_DOMAIN}:${CONFIG.TCP_PORT}`,
    uptime: process.uptime()
  });
});

app.get("/config", (req, res) => {
  res.json({
    uuid: CONFIG.UUID,
    tcp_domain: CONFIG.TCP_DOMAIN,
    tcp_port: CONFIG.TCP_PORT,
    http_domain: CONFIG.HTTP_DOMAIN,
    xray_port: CONFIG.XRAY_PORT
  });
});

// 启动
boot();

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log("========================================");
  console.log("✅ HTTP 订阅服务已启动");
  console.log(`   订阅: https://${CONFIG.HTTP_DOMAIN}/sub`);
  console.log(`   健康: https://${CONFIG.HTTP_DOMAIN}/health`);
  console.log(`   配置: https://${CONFIG.HTTP_DOMAIN}/config`);
  console.log("\n✅ TCP Proxy 端点（原生 IP）:");
  console.log(`   ${CONFIG.TCP_DOMAIN}:${CONFIG.TCP_PORT}`);
  console.log("========================================\n");
});

process.on("SIGTERM", () => {
  console.log("\n[关闭] 收到 SIGTERM 信号");
  process.exit(0);
});
