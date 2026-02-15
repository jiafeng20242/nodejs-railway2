const express = require("express");
const app = express();
const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

// ============================================================================
// I. 核心配置 (Enhanced Config with Validation)
// ============================================================================

const CONFIG = {
  // 身份认证
  UUID: process.env.UUID || "9afd1229-b893-40c1-84dd-51e7ce204913",
  PORT: parseInt(process.env.PORT) || 8080,

  // Argo 隧道配置
  ARGO_DOMAIN: process.env.ARGO_DOMAIN?.trim() || "",
  ARGO_AUTH: process.env.ARGO_AUTH?.trim() || "",
  ARGO_PORT: 8001,

  // 路径与订阅
  SUB_PATH: (process.env.SUB_PATH || "sub").replace(/^\/+/, ""),
  NAME: process.env.NAME || "Railway-Xray",
  FILE_PATH: process.env.FILE_PATH || "./bin_core",

  // 性能参数
  LOG_LEVEL: process.env.LOG_LEVEL || "warning", // error, warning, info, debug
  ENABLE_STATS: process.env.ENABLE_STATS !== "false",
  RESTART_DELAY: 5000, // 5秒内崩溃自动重启
};

// UUID 格式校验
if (!isValidUUID(CONFIG.UUID)) {
  console.error(
    "[ERROR] Invalid UUID format. Please provide a valid UUIDv4."
  );
  process.exit(1);
}

function isValidUUID(uuid) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    uuid
  );
}

// ============================================================================
// II. 日志系统 (Enhanced Logging with Levels)
// ============================================================================

const LOG_LEVELS = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

const currentLogLevel = LOG_LEVELS[CONFIG.LOG_LEVEL] || LOG_LEVELS.info;

const logger = {
  error: (msg) => {
    if (currentLogLevel >= LOG_LEVELS.error)
      console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  },
  warn: (msg) => {
    if (currentLogLevel >= LOG_LEVELS.warning)
      console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`);
  },
  info: (msg) => {
    if (currentLogLevel >= LOG_LEVELS.info)
      console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
  },
  debug: (msg) => {
    if (currentLogLevel >= LOG_LEVELS.debug)
      console.log(`\x1b[35m[DEBUG]\x1b[0m ${msg}`);
  },
  success: (msg) => {
    console.log(`\x1b[32m[✓]\x1b[0m ${msg}`);
  },
};

// ============================================================================
// III. 系统工具集 (System Utils with Enhanced Error Handling)
// ============================================================================

// 初始化目录
if (!fs.existsSync(CONFIG.FILE_PATH)) {
  try {
    fs.mkdirSync(CONFIG.FILE_PATH, { recursive: true });
    logger.info(`Created working directory: ${CONFIG.FILE_PATH}`);
  } catch (err) {
    logger.error(`Failed to create directory: ${err.message}`);
    process.exit(1);
  }
}

// 架构检测 (支持更多架构)
function getArch() {
  const arch = os.arch();
  const mapping = {
    x64: "amd64",
    x32: "386",
    arm64: "arm64",
    arm: "arm",
    aarch64: "arm64",
  };
  return mapping[arch] || "amd64";
}

// 获取系统类型
function getOS() {
  const platform = os.platform();
  const mapping = {
    linux: "linux",
    darwin: "darwin",
    win32: "windows",
  };
  return mapping[platform] || "linux";
}

// 增强的下载器 (支持重试、超时、进度、多镜像源)
async function downloadFileWithFallback(urls, filename, maxRetries = 3) {
  const filePath = path.join(CONFIG.FILE_PATH, filename);
  let lastError;

  // 遍历所有镜像源
  for (const url of urls) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `Downloading ${filename} from ${url} (attempt ${attempt}/${maxRetries})...`
        );

        const response = await axios({
          method: "get",
          url: url,
          responseType: "stream",
          timeout: 30000,
          maxRedirects: 5,
        });

        const totalLength = parseInt(
          response.headers["content-length"],
          10
        );
        let downloadedLength = 0;

        return new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(filePath);

          response.data.on("data", (chunk) => {
            downloadedLength += chunk.length;
            const percent = (
              ((downloadedLength / totalLength) * 100) ||
              0
            ).toFixed(1);
            logger.debug(`${filename}: ${percent}%`);
          });

          response.data.pipe(writer);

          writer.on("finish", () => {
            try {
              writer.close();
              fs.chmodSync(filePath, 0o755);
              logger.success(`${filename} ready.`);
              resolve(filePath);
            } catch (err) {
              reject(err);
            }
          });

          writer.on("error", (err) => {
            fs.unlink(filePath, () => {});
            reject(err);
          });

          response.data.on("error", (err) => {
            writer.destroy();
            fs.unlink(filePath, () => {});
            reject(err);
          });
        });
      } catch (error) {
        lastError = error;
        logger.warn(`Download attempt ${attempt} failed: ${error.message}`);

        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {}
        }

        if (attempt < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 * attempt)
          );
        }
      }
    }
  }

  throw new Error(
    `Failed to download ${filename} after all attempts: ${lastError.message}`
  );
}

// ============================================================================
// IV. Xray 配置生成 (高性能配置)
// ============================================================================

function generateXrayConfig() {
  const config = {
    log: {
      loglevel: CONFIG.LOG_LEVEL,
      access: "", // 禁用访问日志以提升性能
    },
    inbounds: [
      // 【优化】主 VLESS 入口 - 支持 Vision + TCP 回落
      {
        port: CONFIG.ARGO_PORT,
        protocol: "vless",
        settings: {
          clients: [
            {
              id: CONFIG.UUID,
              flow: "xtls-rprx-vision",
              level: 0,
            },
          ],
          decryption: "none",
          fallbacks: [
            {
              alpn: "http/1.1",
              dest: 3001,
            },
            {
              alpn: "h2",
              path: "/grpc",
              dest: 3002,
            },
          ],
        },
        streamSettings: {
          network: "tcp",
          tcpSettings: {
            // 【关键优化】TCP 性能参数
            header: {
              type: "none",
            },
          },
          security: "none",
        },
        sniffing: {
          // 【性能优化】流量识别提升路由效率
          enabled: true,
          destOverride: ["http", "tls", "quic"],
          metadataOnly: false,
        },
      },

      // TCP 回落端口
      {
        port: 3001,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: CONFIG.UUID }],
          decryption: "none",
        },
        streamSettings: {
          network: "tcp",
          security: "none",
        },
      },

      // gRPC 回落端口 (高速模式)
      {
        port: 3002,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: CONFIG.UUID }],
          decryption: "none",
        },
        streamSettings: {
          network: "grpc",
          grpcSettings: {
            serviceName: "grpc",
            multiMode: true,
            // 【优化】gRPC 连接池
          },
          security: "none",
        },
      },
    ],

    outbounds: [
      {
        protocol: "freedom",
        tag: "direct",
        settings: {
          domainStrategy: "UseIPv4", // Railway 偏好 IPv4
        },
      },
      {
        protocol: "blackhole",
        tag: "block",
        settings: {
          response: {
            type: "http",
          },
        },
      },
    ],

    routing: {
      // 【新增】路由规则，防止循环
      rules: [
        {
          type: "field",
          inboundTag: ["in"],
          outboundTag: "direct",
        },
      ],
    },

    // 【新增】系统配置
    policy: {
      levels: {
        0: {
          handshake: 4,
          connIdle: 300,
          uplinkOnly: 2,
          downlinkOnly: 5,
          statsUserUplink: false,
          statsUserDownlink: false,
          bufferSize: 10240, // 10MB 缓冲区优化
        },
      },
      system: {
        statsInboundUplink: CONFIG.ENABLE_STATS,
        statsInboundDownlink: CONFIG.ENABLE_STATS,
        statsOutboundUplink: CONFIG.ENABLE_STATS,
        statsOutboundDownlink: CONFIG.ENABLE_STATS,
      },
    },
  };

  try {
    fs.writeFileSync(
      path.join(CONFIG.FILE_PATH, "config.json"),
      JSON.stringify(config, null, 2)
    );
    logger.success("Xray config generated.");
  } catch (err) {
    logger.error(`Failed to write Xray config: ${err.message}`);
    throw err;
  }
}

// ============================================================================
// V. Argo 隧道管理 (Enhanced with Auto-Restart)
// ============================================================================

let argoProcess = null;
let argoRestartAttempts = 0;
const MAX_ARGO_RESTARTS = 5;

async function startArgo(binPath) {
  const args = buildArgoArgs();
  
  logger.info(
    `Starting Argo tunnel with mode: ${args[0] === "tunnel" ? "Tunnel" : "Other"}`
  );

  argoProcess = spawn(binPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  // 【重要】设置进程优先级（可选）
  if (process.platform === "linux" && argoProcess.pid) {
    try {
      require("child_process").execSync(
        `renice -n 10 -p ${argoProcess.pid}`,
        { stdio: "ignore" }
      );
    } catch (e) {}
  }

  let domainFound = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!domainFound) {
        logger.warn("Argo startup timeout - continuing anyway");
      }
      resolve();
    }, 15000);

    // 实时捕获日志
    argoProcess.stdout.on("data", (data) => {
      const log = data.toString();
      handleArgoLog(log);
      
      if (log.includes("trycloudflare.com") && !domainFound) {
        domainFound = true;
        const match = log.match(
          /https:\/\/([\w\-]+\.trycloudflare\.com)/
        );
        if (match) {
          logger.success(`Argo temp domain: ${match[1]}`);
          if (!CONFIG.ARGO_DOMAIN) {
            CONFIG.ARGO_DOMAIN = match[1];
          }
        }
      }
    });

    argoProcess.stderr.on("data", (data) => {
      const log = data.toString();
      if (log.includes("error") || log.includes("ERRO")) {
        logger.error(`Argo: ${log}`);
      } else if (
        log.includes("warn") ||
        log.includes("WARN")
      ) {
        logger.warn(`Argo: ${log}`);
      } else {
        logger.debug(`Argo: ${log}`);
      }
    });

    argoProcess.on("error", (err) => {
      clearTimeout(timeout);
      logger.error(`Argo spawn error: ${err.message}`);
      reject(err);
    });

    argoProcess.on("exit", (code, signal) => {
      clearTimeout(timeout);
      logger.warn(
        `Argo process exited with code ${code}, signal ${signal}`
      );
      
      // 自动重启逻辑
      if (argoRestartAttempts < MAX_ARGO_RESTARTS) {
        argoRestartAttempts++;
        logger.info(
          `Attempting Argo restart ${argoRestartAttempts}/${MAX_ARGO_RESTARTS}...`
        );
        setTimeout(
          () => startArgo(binPath).catch((e) => logger.error(e.message)),
          CONFIG.RESTART_DELAY
        );
      } else {
        logger.error("Max Argo restart attempts reached");
      }
    });
  });
}

function buildArgoArgs() {
  // Token 方式（优先级最高）
  if (
    CONFIG.ARGO_AUTH &&
    CONFIG.ARGO_AUTH.length > 100 &&
    !CONFIG.ARGO_AUTH.includes("{")
  ) {
    logger.info("Using Argo Token mode");
    return [
      "tunnel",
      "--edge-ip-version",
      "auto",
      "--no-autoupdate",
      "--protocol",
      "http2",
      "run",
      "--token",
      CONFIG.ARGO_AUTH,
    ];
  }

  // JSON Secret 方式
  if (CONFIG.ARGO_AUTH && CONFIG.ARGO_AUTH.includes("TunnelSecret")) {
    logger.info("Using Argo JSON Secret mode");
    try {
      const json = JSON.parse(CONFIG.ARGO_AUTH);
      const tunnelId = json.TunnelID;

      fs.writeFileSync(
        path.join(CONFIG.FILE_PATH, "tunnel.json"),
        CONFIG.ARGO_AUTH
      );

      const tunnelYaml = `
tunnel: ${tunnelId}
credentials-file: ${path.join(CONFIG.FILE_PATH, "tunnel.json")}
protocol: http2
no-autoupdate: true
edge-ip-version: auto

ingress:
  - hostname: ${CONFIG.ARGO_DOMAIN}
    service: http://localhost:${CONFIG.ARGO_PORT}
    originRequest:
      noTLSVerify: true
      http2Origin: true
      
  - service: http_status:404
`;

      fs.writeFileSync(
        path.join(CONFIG.FILE_PATH, "tunnel.yml"),
        tunnelYaml
      );

      return [
        "tunnel",
        "--config",
        path.join(CONFIG.FILE_PATH, "tunnel.yml"),
        "run",
      ];
    } catch (err) {
      logger.warn(`Failed to parse JSON Secret: ${err.message}`);
    }
  }

  // 临时隧道 (Fallback)
  logger.info("Using Argo Temporary Tunnel mode");
  return [
    "tunnel",
    "--edge-ip-version",
    "auto",
    "--no-autoupdate",
    "--protocol",
    "http2",
    "--url",
    `http://localhost:${CONFIG.ARGO_PORT}`,
  ];
}

function handleArgoLog(log) {
  // 关键信息
  if (
    log.includes("Connected to Cloudflare") ||
    log.includes("registered tunnel")
  ) {
    logger.success(`Argo: ${log.trim()}`);
  } else if (log.includes("error") || log.includes("ERROR")) {
    logger.error(`Argo: ${log.trim()}`);
  } else if (log.includes("WARN")) {
    logger.warn(`Argo: ${log.trim()}`);
  }
}

// ============================================================================
// VI. Xray 进程管理 (Enhanced with Auto-Restart)
// ============================================================================

let xrayProcess = null;
let xrayRestartAttempts = 0;
const MAX_XRAY_RESTARTS = 5;

function startXray(xrayPath) {
  logger.info("Launching Xray core...");

  const configPath = path.join(CONFIG.FILE_PATH, "config.json");
  xrayProcess = spawn(xrayPath, ["-c", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  // 错误处理
  xrayProcess.on("error", (err) => {
    logger.error(`Xray spawn error: ${err.message}`);
  });

  xrayProcess.stderr.on("data", (data) => {
    const log = data.toString().trim();
    if (log.includes("failed") || log.includes("error")) {
      logger.error(`Xray: ${log}`);
    } else if (log) {
      logger.debug(`Xray: ${log}`);
    }
  });

  xrayProcess.on("exit", (code, signal) => {
    logger.warn(
      `Xray process exited with code ${code}, signal ${signal}`
    );

    // 自动重启
    if (xrayRestartAttempts < MAX_XRAY_RESTARTS) {
      xrayRestartAttempts++;
      logger.info(
        `Attempting Xray restart ${xrayRestartAttempts}/${MAX_XRAY_RESTARTS}...`
      );
      setTimeout(
        () => startXray(xrayPath),
        CONFIG.RESTART_DELAY
      );
    } else {
      logger.error("Max Xray restart attempts reached - giving up");
    }
  });

  logger.success("Xray core started.");
}

// ============================================================================
// VII. 订阅链接生成
// ============================================================================

function generateLinks(domain) {
  if (!domain) {
    return "ERROR: Argo domain not ready. Check logs.";
  }

  const cleanDomain = domain.replace(/^https?:\/\//, "").split(":")[0];

  const links = {
    vision: `vless://${CONFIG.UUID}@${cleanDomain}:443?encryption=none&flow=xtls-rprx-vision&security=tls&sni=${cleanDomain}&fp=chrome&type=tcp&headerType=none#${CONFIG.NAME}-Vision`,
    grpc: `vless://${CONFIG.UUID}@${cleanDomain}:443?encryption=none&security=tls&sni=${cleanDomain}&fp=chrome&type=grpc&serviceName=grpc&mode=gun#${CONFIG.NAME}-gRPC`,
  };

  return `${links.vision}\n${links.grpc}`;
}

// ============================================================================
// VIII. 启动流程 (Boot Sequence)
// ============================================================================

async function boot() {
  const arch = getArch();
  const osType = getOS();
  logger.info(`System architecture: ${arch}, OS: ${osType}`);

  // 修复：使用多个可靠的 Xray 镜像源，且根据架构动态生成链接
  const xrayFilename = `xray-${osType}-${arch}`;
  const xrayUrls = [
    // 主镜像源
    `https://github.com/XTLS/Xray-core/releases/latest/download/${xrayFilename}`,
    // 备用镜像源1
    `https://cdn.jsdelivr.net/gh/XTLS/Xray-core@main/releases/latest/download/${xrayFilename}`,
    // 备用镜像源2
    `https://raw.githubusercontent.com/XTLS/Xray-core/main/releases/latest/download/${xrayFilename}`,
  ];

  const urls = {
    xray: xrayUrls,
    argo: [
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
      "https://cdn.jsdelivr.net/gh/cloudflare/cloudflared@latest/releases/latest/download/cloudflared-linux-amd64"
    ],
  };

  try {
    // 生成配置
    generateXrayConfig();

    // 并发下载（使用多镜像源下载函数）
    logger.info("Downloading core binaries...");
    const [xrayPath, argoPath] = await Promise.all([
      downloadFileWithFallback(urls.xray, "xray"),
      downloadFileWithFallback(urls.argo, "cloudflared"),
    ]);

    logger.success("All binaries downloaded.");

    // 启动 Xray
    startXray(xrayPath);

    // 给 Xray 2 秒启动时间
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 启动 Argo
    await startArgo(argoPath);

    logger.success("Boot sequence completed successfully!");
  } catch (err) {
    logger.error(`Boot failed: ${err.message}`);
    process.exit(1);
  }
}

// ============================================================================
// IX. Express 服务器 (HTTP Service)
// ============================================================================

app.use(express.text()); // 支持纯文本

// 健康检查
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 主页
app.get("/", (req, res) => {
  const uptime = Math.floor(process.uptime());
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Railway Xray Service</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; margin-top: 0; }
            .status { color: #27ae60; font-size: 18px; }
            .info { background: #ecf0f1; padding: 15px; border-radius: 5px; margin: 20px 0; }
            code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Railway Xray Service</h1>
            <p class="status">✓ System Online</p>
            <div class="info">
                <p><strong>Uptime:</strong> ${uptime}s</p>
                <p><strong>Architecture:</strong> ${getArch()}</p>
                <p><strong>Node.js:</strong> ${process.version}</p>
            </div>
            <p>Subscribe URL: <code>/${CONFIG.SUB_PATH}</code></p>
        </div>
    </body>
    </html>
  `;
  res.type("html").send(html);
});

// 订阅接口
app.get(`/${CONFIG.SUB_PATH}`, (req, res) => {
  const domain = CONFIG.ARGO_DOMAIN || "pending";
  const links = generateLinks(domain);
  const base64 = Buffer.from(links).toString("base64");
  res.type("text/plain").send(base64);
});

// 优雅关闭处理
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

function gracefulShutdown() {
  logger.warn("Received shutdown signal. Cleaning up...");

  if (xrayProcess) {
    try {
      xrayProcess.kill("SIGTERM");
    } catch (e) {}
  }

  if (argoProcess) {
    try {
      argoProcess.kill("SIGTERM");
    } catch (e) {}
  }

  setTimeout(() => {
    logger.info("Shutdown complete.");
    process.exit(0);
  }, 5000);
}

// 启动服务器
boot();

const server = app.listen(CONFIG.PORT, "::", () => {
  logger.success(`HTTP Server listening on [::]:${CONFIG.PORT}`);
});

// 防止内存泄漏
server.keepAliveTimeout = 65000;
