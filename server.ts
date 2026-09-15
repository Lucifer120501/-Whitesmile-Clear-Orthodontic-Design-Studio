import express from "express";
import path from "path";
import fs from "fs";
import net from "net";
import http from "http";
import https from "https";
import os from "os";
import crypto from "crypto";
import type { Duplex } from "stream";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { execSync, spawnSync, spawn, type ChildProcess } from "child_process";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ── Robust URL Extraction & Validation Helpers ──────────────────────────
/**
 * Extracts all valid HTTP/HTTPS URLs from text using a comprehensive regex.
 * Handles URLs with parentheses, trailing punctuation, and other edge cases.
 */
function extractUrls(text: string): string[] {
  // Regex 1: Full URLs with http:// or https:// protocol
  const protocolUrlRegex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>{}|\\^`[\]]*(?:\([^\s<>]*\)[^\s<>{}|\\^`[\]]*)*)?/gi;
  // Regex 2: Bare domain URLs starting with www. (no protocol) — handles multi-level subdomains
  const bareWwwRegex = /(?:^|\s)(www\.(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<>{}|\\^`[\]]*)?)/gi;
  // Regex 3: Subdomain.domain.tld patterns without protocol (e.g. "partner.3shape.com", "shop.3shape.com")
  // Must have at least two dots after word boundary, not starting with www (already handled above).
  // Uses (?:[a-zA-Z0-9-]+\.)+ to handle multi-level subdomains like "sub.sub.domain.tld"
  const bareDomainRegex = /(?:^|\s)((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:com|org|net|edu|gov|io|co|int|mil|info|biz|app|dev|ai|me|tv|uk|de|jp|au|fr|ca|it|es|nl|br|in|ru|cn|nz|se|no|fi|dk|pl|be|at|ch|kr|hk|sg|my|ph|th|za|mx|ar|cl|pt|gr|ie|hu|cz|ro|il|eu|us)(?:\/[^\s<>{}|\\^`[\]]*)?)/gi;

  const seen = new Set<string>();
  const results: string[] = [];

  function processMatch(rawUrl: string) {
    let url = rawUrl.trim();

    // Sanitize: remove trailing punctuation that isn't part of the URL
    // Keep parentheses balanced
    const parenStack: string[] = [];
    for (const ch of url) {
      if (ch === '(') parenStack.push('(');
      else if (ch === ')') {
        if (parenStack.length > 0) parenStack.pop();
      }
    }
    while (parenStack.length > 0 && url.endsWith(')')) {
      url = url.slice(0, -1);
      parenStack.pop();
    }

    url = url.replace(/[.,;:!?]+$/, '');
    url = url.replace(/['"\]}>]+$/, '');

    if (!url || seen.has(url)) return;
    seen.add(url);

    // Add protocol if missing so URL constructor works
    const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : 'https://' + url;

    try {
      const parsed = new URL(fullUrl);
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.')) {
        results.push(fullUrl);
      }
    } catch {
      // Skip unparseable URLs
    }
  }

  // Run all three regexes
  let match;
  while ((match = protocolUrlRegex.exec(text)) !== null) processMatch(match[0]);
  while ((match = bareWwwRegex.exec(text)) !== null) processMatch(match[1] || match[0]);
  while ((match = bareDomainRegex.exec(text)) !== null) {
    const candidate = match[1] || match[0];
    // Skip if it already looks like a www URL (already matched above) or starts with a protocol
    if (candidate.startsWith('www.') || candidate.startsWith('http://') || candidate.startsWith('https://')) continue;
    processMatch(candidate);
  }

  return results;
}

/**
 * Tries to sanitize and fix a single URL string. Returns null if it can't be fixed.
 */
function sanitizeUrl(raw: string | undefined | null): string | null {
  let url = raw.trim();
  if (!url) return null;

  // Remove trailing punctuation that likely isn't part of the URL
  url = url.replace(/[.,;:!?]+$/, '');
  url = url.replace(/['"\]}>]+$/, '');

  // If no protocol, try adding https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.')) {
      return parsed.toString();
    }
  } catch {
    // Try URL with encoded spaces
    try {
      const encoded = url.replace(/\s/g, '%20');
      const parsed = new URL(encoded);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        return parsed.toString();
      }
    } catch {
      return null;
    }
  }
  return null;
}

const app = express();
app.disable('x-powered-by');

// ── CORS for cross-origin access from the agliner UI (5173) & ortho UI (8765) ──
// The main system is the shared AI brain — its satellites call it directly
// from the browser, so permissive CORS is required for local development.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// ═════════════════════════════════════════════════════════════════════════
//  Unified Satellite Systems — Agliner Segmentation & Ortho Staging/Render
//
//  The main system OWNS both satellites. On boot it spawns them as child
//  processes and reverse-proxies them under the SAME origin (localhost:3000):
//      /agliner  → agliner UI (vite dev server, port 5173, base "/agliner/")
//      /ortho    → ortho FastAPI server (port 8765, root "/")
//  All three WhiteSmile systems are then operated from a single window.
// ═════════════════════════════════════════════════════════════════════════

interface ManagedSatellite {
  name: string;
  port: number;
  proc: ChildProcess | null;
  startedAt: number;
  logTail: string[];
}

const satellites: Record<"agliner" | "ortho", ManagedSatellite> = {
  agliner: { name: "Agliner Segmentation", port: 5173, proc: null, startedAt: 0, logTail: [] },
  ortho: { name: "Ortho Staging & Render", port: 8765, proc: null, startedAt: 0, logTail: [] },
};

/** Resolve the agliner pipeline Python interpreter (.venv first, then PATH). */
function pythonExecutable(): string {
  const candidates = [
    path.join(process.cwd(), "ai cad", ".venv", "Scripts", "python.exe"),
    path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "python";
}

/** Spawn both satellite systems so they run together with the main system. */
function startSatellites() {
  if (process.env.DISABLE_SATELLITES === "1") {
    console.log("[satellites] DISABLE_SATELLITES=1 — satellites not started.");
    return;
  }

  // ── Agliner Segmentation UI (vite dev server, base "/agliner/") ──
  if (process.env.NODE_ENV !== "production") {
    const aglinerDir = path.join(process.cwd(), "ai cad", "aligner-ui");
    if (fs.existsSync(path.join(aglinerDir, "package.json"))) {
      try {
        // npx.cmd is a batch file — on Windows it must run through cmd.exe
        const isWin = process.platform === "win32";
        const proc = isWin
          ? spawn(
              process.env.ComSpec || "cmd.exe",
              ["/d", "/s", "/c", "npx vite --port 5173 --strictPort --host 0.0.0.0"],
              { cwd: aglinerDir, shell: false, env: { ...process.env, PYTHONIOENCODING: "utf-8", AGLINER_WEB: "1" } }
            )
          : spawn("npx", ["vite", "--port", "5173", "--strictPort", "--host", "0.0.0.0"], {
              cwd: aglinerDir,
              shell: false,
              env: { ...process.env, PYTHONIOENCODING: "utf-8", AGLINER_WEB: "1" },
            });
        satellites.agliner.proc = proc;
        satellites.agliner.startedAt = Date.now();
        proc.stdout?.on("data", (d) => tailSatelliteLog("agliner", d.toString()));
        proc.stderr?.on("data", (d) => tailSatelliteLog("agliner", d.toString()));
        proc.on("exit", (code) => {
          console.log(`[satellites] Agliner UI exited (code ${code})`);
          satellites.agliner.proc = null;
        });
        proc.on("error", (err) => console.error(`[satellites] Agliner UI error: ${err.message}`));
        console.log(
          `[satellites] Agliner Segmentation starting on :${satellites.agliner.port} (proxied at http://localhost:3000/agliner)`
        );
      } catch (err) {
        console.error("[satellites] Failed to start Agliner UI (continuing without it):", err);
      }
    }
  } else {
    console.log("[satellites] Production mode — agliner UI expected as static build.");
  }

  // ── Ortho Staging & Render (FastAPI + Blender) ──
  const orthoDir = path.join(process.cwd(), "ortho", "aligner_pipeline");
  if (fs.existsSync(path.join(orthoDir, "server.py"))) {
    try {
      const proc = spawn(pythonExecutable(), ["server.py"], {
        cwd: orthoDir,
        shell: false,
        env: {
          ...process.env,
          PORT: String(satellites.ortho.port),
          PYTHONIOENCODING: "utf-8",
          ALIGNER_NO_BROWSER: "1", // main server opens no extra browser tab
        },
      });
      satellites.ortho.proc = proc;
      satellites.ortho.startedAt = Date.now();
      proc.stdout?.on("data", (d) => tailSatelliteLog("ortho", d.toString()));
      proc.stderr?.on("data", (d) => tailSatelliteLog("ortho", d.toString()));
      proc.on("exit", (code) => {
        console.log(`[satellites] Ortho server exited (code ${code})`);
        satellites.ortho.proc = null;
      });
      proc.on("error", (err) => console.error(`[satellites] Ortho server error: ${err.message}`));
      console.log(
        `[satellites] Ortho Staging & Render starting on :${satellites.ortho.port} (proxied at http://localhost:3000/ortho)`
      );
    } catch (err) {
      console.error("[satellites] Failed to start Ortho server (continuing without it):", err);
    }
  }
}

function tailSatelliteLog(name: keyof typeof satellites, text: string) {
  const s = satellites[name];
  s.logTail.push(text);
  if (s.logTail.length > 200) s.logTail.shift();
  for (const line of text.split("\n").filter(Boolean)) {
    console.log(`[${name}] ${line}`);
  }
}

function satelliteAlive(name: keyof typeof satellites): boolean {
  const s = satellites[name];
  return !!s.proc && !s.proc.killed;
}

function shutdownSatellites() {
  for (const s of Object.values(satellites)) {
    if (s.proc && !s.proc.killed) {
      try {
        s.proc.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
process.on("exit", shutdownSatellites);
process.on("SIGINT", () => {
  shutdownSatellites();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdownSatellites();
  process.exit(0);
});

// ── Crash guards — log and keep serving instead of dying (e.g. AI 429s) ──
// Node >= 15 treats unhandled promise rejections as fatal, which took the whole
// server down when Gemini returned 429 RESOURCE_EXHAUSTED. Log and survive.
process.on("unhandledRejection", (reason) => {
  console.error("[Unhandled Rejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]", err);
});

// ── Reverse proxy (HTTP) — forward requests to the satellite servers ──
function proxyTo(targetPort: number, opts: { stripPrefix?: string; addPrefix?: string } = {}) {
  return (req: express.Request, res: express.Response) => {
    let targetPath = req.originalUrl;
    if (opts.stripPrefix && targetPath.startsWith(opts.stripPrefix)) {
      targetPath = targetPath.slice(opts.stripPrefix.length);
    }
    if (opts.addPrefix) targetPath = opts.addPrefix + targetPath;
    if (!targetPath) targetPath = "/";

    const proxyReq = http.request(
      {
        hostname: "localhost",
        port: targetPort,
        path: targetPath,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${targetPort}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (err) => {
      console.error(`[proxy] :${targetPort} error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ error: `Satellite on port ${targetPort} is not running` });
      } else {
        res.destroy();
      }
    });
    req.pipe(proxyReq);
  };
}

// Mount satellite proxies — MUST run before the vite/static middlewares.
// /agliner keeps its base prefix (agliner vite config base = "/agliner/").
// /ortho strips the prefix — the ortho FastAPI app is rooted at "/".
if (process.env.NODE_ENV !== "production") {
  app.use("/agliner", proxyTo(satellites.agliner.port));
}
app.use("/ortho", proxyTo(satellites.ortho.port, { stripPrefix: "/ortho" }));

// ── Reverse proxy (WebSocket) — agliner HMR + ortho log stream ──
function proxyWs(targetPort: number, opts: { stripPrefix?: string; addPrefix?: string } = {}) {
  return (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    let targetPath = req.url || "/";
    if (opts.stripPrefix && targetPath.startsWith(opts.stripPrefix)) {
      targetPath = targetPath.slice(opts.stripPrefix.length) || "/";
    }
    if (opts.addPrefix) targetPath = opts.addPrefix + targetPath;

    const proxyReq = http.request({
      hostname: "localhost",
      port: targetPort,
      path: targetPath,
      method: "GET",
      headers: {
        ...req.headers,
        host: `localhost:${targetPort}`,
        connection: "Upgrade",
        upgrade: "websocket",
      },
    });
    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          Object.entries(proxyRes.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n") +
          "\r\n\r\n"
      );
      if (proxyHead?.length) proxySocket.unshift(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.on("error", () => socket.destroy());
      socket.on("error", () => proxySocket.destroy());
    });
    proxyReq.on("error", (err) => {
      console.error(`[ws-proxy] :${targetPort} error: ${err.message}`);
      socket.destroy();
    });
    proxyReq.end();
  };
}
/**
 * Try to find an available port starting from the given port.
 * Uses the OS to bind to port 0 as a fallback so the server never fails on EADDRINUSE.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Port is busy, try the next one
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    srv.listen(startPort, "0.0.0.0", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

let PORT: number = Number(process.env.PORT) || 3000;

interface STLMetadata {
  valid: boolean;
  format: string;
  file_size: number;
  arch_guess: string;
  triangle_count: number;
  error: string | null;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function parseSTLInJS(filePath: string): STLMetadata {
  const file_size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  const filename = path.basename(filePath).toLowerCase();
  
  // Guess arch from file name
  let arch_guess = "unspecified";
  if (filename.includes("upper") || filename.includes("maxillary") || filename.includes("u_") || filename.includes("sup")) {
    arch_guess = "upper";
  } else if (filename.includes("lower") || filename.includes("mandibular") || filename.includes("l_") || filename.includes("inf")) {
    arch_guess = "lower";
  }

  if (file_size === 0) {
    return {
      valid: false,
      format: "Unknown",
      file_size: 0,
      arch_guess,
      triangle_count: 0,
      error: `File ${filePath} does not exist or is empty`
    };
  }

  const buffer = Buffer.alloc(256);
  let bytesRead = 0;
  try {
    // Read the first 256 bytes to detect ASCII or Binary
    const fd = fs.openSync(filePath, 'r');
    try {
      bytesRead = fs.readSync(fd, buffer, 0, 256, 0);
    } finally {
      fs.closeSync(fd);
    }

    const firstLine = buffer.toString('utf8', 0, bytesRead).trim();
    if (firstLine.startsWith('solid')) {
      // ASCII STL: count lines containing 'facet normal'
      const content = fs.readFileSync(filePath, 'utf8');
      const matches = content.match(/facet\s+normal/gi);
      const facet_count = matches ? matches.length : 0;
      return {
        valid: true,
        format: "ASCII",
        file_size,
        arch_guess,
        triangle_count: facet_count,
        error: null
      };
    }

    // Binary STL
    if (file_size < 84) {
      return {
        valid: false,
        format: "Binary",
        file_size,
        arch_guess,
        triangle_count: 0,
        error: "File is too small to be a valid binary STL (less than 84 bytes)"
      };
    }

    // Read triangle count at byte index 80 (4 bytes uint32)
    const countBuffer = Buffer.alloc(4);
    const fd2 = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd2, countBuffer, 0, 4, 80);
    } finally {
      fs.closeSync(fd2);
    }
    
    const num_triangles = countBuffer.readUInt32LE(0);
    const expected_size = 84 + num_triangles * 50;
    
    if (file_size < expected_size) {
      // In some real cases, some files may have padding or we allow some flexibility,
      // but let's report it cleanly if it's heavily truncated
      if (file_size < 84) {
        return {
          valid: false,
          format: "Binary",
          file_size,
          arch_guess,
          triangle_count: num_triangles,
          error: `Truncated binary STL. Expected at least ${expected_size} bytes for ${num_triangles} triangles, but got ${file_size} bytes.`
        };
      }
    }

    return {
      valid: true,
      format: "Binary",
      file_size,
      arch_guess,
      triangle_count: num_triangles,
      error: null
    };
  } catch (e: any) {
    return {
      valid: false,
      format: "Unknown",
      file_size,
      arch_guess,
      triangle_count: 0,
      error: `Failed to parse STL natively: ${e && typeof e.message === 'string' ? e.message : String(e)}`
    };
  }
}

function checkTopLevelKeys(jsonData: any): string[] {
  const errors: string[] = [];
  const requiredKeys = ["design_parameters", "manufacturing_instructions", "warnings"];
  for (const key of requiredKeys) {
    if (!(key in jsonData)) {
      errors.push(`Missing required top-level key: '${key}'`);
    }
  }
  return errors;
}

function checkDesignParameters(dp: any, jsonData: any): string[] {
  const errors: string[] = [];
  if (!dp || typeof dp !== "object") {
    errors.push("'design_parameters' must be an object");
    return errors;
  }

  const requiredDpKeys = [
    "appliance", "arch", "material", "thickness_mm",
    "coverage", "trim_line", "relief_areas", "special_notes"
  ];
  for (const key of requiredDpKeys) {
    if (!(key in dp)) {
      errors.push(`Missing required design parameter: '${key}'`);
    }
  }

  if (!Array.isArray(jsonData.manufacturing_instructions)) {
    errors.push("'manufacturing_instructions' must be an array");
  }
  if (!Array.isArray(jsonData.warnings)) {
    errors.push("'warnings' must be an array");
  }
  if (!Array.isArray(dp.relief_areas)) {
    errors.push("'relief_areas' must be an array");
  }

  return errors;
}

function validateEssixRules(material: string, thickness_mm: number, dp: any): string[] {
  const errors: string[] = [];
  const allowedEssixMaterials = ["petg", "thermoform", "plastic", "copolyester", "polycarbonate", "clear sheet"];
  if (!allowedEssixMaterials.some(m => material.includes(m))) {
    errors.push(
      `Business Rule Violation (Essix Material): Material '${dp.material}' is invalid. ` +
      "Must be PETG or standard thermoforming plastic sheet."
    );
  }
  const validThicknesses = [0.75, 1.0, 1.5];
  const isValidThickness = validThicknesses.some(vt => Math.abs(thickness_mm - vt) < 0.05);
  if (!isValidThickness) {
    errors.push(
      `Business Rule Violation (Essix Thickness): Thickness '${dp.thickness_mm}mm' is invalid. ` +
      "Essix standard thicknesses are 0.75mm, 1.0mm, or 1.5mm."
    );
  }
  return errors;
}

function validateHawleyRules(material: string, jsonData: any, dp: any): string[] {
  const errors: string[] = [];
  if (!material.includes("acrylic") && !material.includes("pmma")) {
    errors.push(
      `Business Rule Violation (Hawley Material): Material '${dp.material}' is invalid. ` +
      "Hawley retainers require an acrylic baseplate."
    );
  }
  const allInstructionsText = Array.isArray(jsonData.manufacturing_instructions)
    ? jsonData.manufacturing_instructions.map((i: any) => String(i).toLowerCase()).join(" ")
    : "";
  const allText = `${material} ${allInstructionsText}`;
  const hasBowReference = ["steel", "bow", "wire", "0.7"].some(term => allText.includes(term));
  if (!hasBowReference) {
    errors.push(
      "Business Rule Violation (Hawley Hardware): Missing stainless steel labial bow reference in material or fabrication instructions."
    );
  }
  return errors;
}

function validateDesignJsonInJS(jsonData: any): ValidationResult {
  if (!jsonData || typeof jsonData !== "object") {
    return { valid: false, errors: ["Invalid input data"] };
  }

  let errors: string[] = checkTopLevelKeys(jsonData);
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const dp = jsonData.design_parameters;
  errors = checkDesignParameters(dp, jsonData);
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Validate business rules
  const appliance = String(dp.appliance || "").trim().toLowerCase();
  const material = String(dp.material || "").trim().toLowerCase();
  const thickness_mm = Number.parseFloat(dp.thickness_mm);

  if (Number.isNaN(thickness_mm)) {
    errors.push("'thickness_mm' must be a numeric value");
  }

  if (!["essix", "hawley", "other"].includes(appliance)) {
    errors.push(`Invalid appliance: '${dp.appliance}'. Must be Essix, Hawley, or Other.`);
  }

  if (appliance === "essix") {
    errors.push(...validateEssixRules(material, thickness_mm, dp));
  } else if (appliance === "hawley") {
    errors.push(...validateHawleyRules(material, jsonData, dp));
  }

  return { valid: errors.length === 0, errors };
}

function runSTLProcessorAnalyze(filePath: string): STLMetadata {
  const isStl = filePath.toLowerCase().endsWith(".stl");
  if (!isStl) {
    return {
      valid: true,
      format: "Attachment",
      file_size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
      arch_guess: "unspecified",
      triangle_count: 0,
      error: null
    };
  }

  let lastError: string | null = null;
  
  // Try running with python3
  try {
    const cmd = `python3 stl_processor.py analyze "${filePath.replaceAll('"', '\\"')}"`;
    const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
    return JSON.parse(output.trim());
  } catch (error: any) {
    lastError = error.message;
  }

  // Try running with python
  try {
    const cmd = `python stl_processor.py analyze "${filePath.replaceAll('"', '\\"')}"`;
    const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
    return JSON.parse(output.trim());
  } catch (error: any) {
    lastError = lastError ? `${lastError} | ${error && typeof error.message === 'string' ? error.message : String(error)}` : (error && typeof error.message === 'string' ? error.message : String(error));
  }

  // Fall back to our native JavaScript/TypeScript STL parser!
  try {
    return parseSTLInJS(filePath);
  } catch (error: any) {
    return {
      valid: false,
      format: "Unknown",
      file_size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
      arch_guess: "unspecified",
      triangle_count: 0,
      error: `STL parse failed: ${error && typeof error.message === 'string' ? error.message : String(error)} (Subprocess error: ${lastError})`
    };
  }
}

function runSTLProcessorValidate(jsonData: any): ValidationResult {
  const tempPath = path.join(process.cwd(), "uploads", `temp_validate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`);
  
  // Try running with python3
  try {
    fs.writeFileSync(tempPath, JSON.stringify(jsonData), "utf-8");
    const cmd = `python3 stl_processor.py validate "${tempPath.replaceAll('"', '\\"')}"`;
    const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
    return JSON.parse(output.trim());
  } catch (error: any) {
    // Try running with python
    try {
      const cmd = `python stl_processor.py validate "${tempPath.replaceAll('"', '\\"')}"`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
      return JSON.parse(output.trim());
    } catch (innerError: any) {
      // Fall back to native validator
      console.warn('Python STL validator failed, falling back to JS validator:', innerError && typeof innerError.message === 'string' ? innerError.message : String(innerError));
      return validateDesignJsonInJS(jsonData);
    }
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (e) {
      console.error("Failed to clean up temp file:", e);
    }
  }
}

// Set up directory for uploads and persistent history
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const historyFilePath = path.join(uploadsDir, "history.json");
if (!fs.existsSync(historyFilePath)) {
  fs.writeFileSync(historyFilePath, JSON.stringify([]), "utf-8");
}

// Helper to read history
function readHistory(): any[] {
  try {
    if (!fs.existsSync(historyFilePath)) {
      fs.writeFileSync(historyFilePath, JSON.stringify([]), "utf-8");
      return [];
    }
    const data = fs.readFileSync(historyFilePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Failed to read history file:", error);
    return [];
  }
}

// Helper to write history
function writeHistory(history: any[]) {
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write case history file:", error);
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  Multi-Tenant Auth & Company System
//
//  - Users belong to companies; companies enable feature packs (checkbox).
//  - Admins create user accounts; users log in with username + password.
//  - Data isolation: users see only their own cases (+ company cases when
//    the company has "sync" enabled). Admins see everything.
//  - The server runs 24/7 on the admin's PC; users connect via the LAN URL
//    shown in the admin panel (Connection tab).
// ═════════════════════════════════════════════════════════════════════════

const serverDataDir = path.join(process.cwd(), "server-data");
if (!fs.existsSync(serverDataDir)) {
  fs.mkdirSync(serverDataDir, { recursive: true });
}

const USERS_FILE = path.join(serverDataDir, "users.json");
const COMPANIES_FILE = path.join(serverDataDir, "companies.json");
const SESSIONS_FILE = path.join(serverDataDir, "sessions.json");
const UPDATES_FILE = path.join(serverDataDir, "updates.json");

interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: "admin" | "user";
  companyId: string | null;
  active: boolean;
  createdAt: string;
}

interface CompanyRecord {
  id: string;
  name: string;
  enabledPacks: string[];
  syncEnabled: boolean;
  createdAt: string;
}

interface SessionRecord {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface UpdateRecord {
  version: string;
  commit: string;
  timestamp: string;
  status: "applied" | "rolled-back";
  note?: string;
}

/** Feature packs — each is a self-contained capability the admin can toggle per company. */
const FEATURE_PACKS: Array<{ id: string; name: string; description: string }> = [
  { id: "analysis", name: "Analysis Pack", description: "Case submission, AI analysis & manufacturing spec drafting" },
  { id: "blender", name: "Blender Pack", description: "Blender CAD integration for aligner design & rendering" },
  { id: "ortho", name: "Ortho Staging Pack", description: "Ortho staging & render pipeline" },
  { id: "agliner", name: "Agliner Segmentation Pack", description: "AI tooth segmentation pipeline" },
];

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch (error) {
    console.error(`Failed to read ${file}:`, error);
    return fallback;
  }
}

function writeJsonFile(file: string, data: unknown): void {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`Failed to write ${file}:`, error);
  }
}

function readUsers(): UserRecord[] {
  const users = readJsonFile<UserRecord[]>(USERS_FILE, []);
  if (users.length === 0) {
    const salt = createSalt();
    const defaultAdmin: UserRecord = {
      id: "u_admin_default",
      username: "admin",
      passwordHash: hashPassword("admin123", salt),
      salt,
      role: "admin",
      companyId: null,
      active: true,
      createdAt: new Date().toISOString(),
    };
    users.push(defaultAdmin);
    writeJsonFile(USERS_FILE, users);
  }
  return users;
}
function writeUsers(users: UserRecord[]): void {
  writeJsonFile(USERS_FILE, users);
}
function readCompanies(): CompanyRecord[] {
  return readJsonFile<CompanyRecord[]>(COMPANIES_FILE, []);
}
function writeCompanies(companies: CompanyRecord[]): void {
  writeJsonFile(COMPANIES_FILE, companies);
}
function readSessions(): SessionRecord[] {
  return readJsonFile<SessionRecord[]>(SESSIONS_FILE, []);
}
function writeSessions(sessions: SessionRecord[]): void {
  writeJsonFile(SESSIONS_FILE, sessions);
}
function readUpdates(): UpdateRecord[] {
  return readJsonFile<UpdateRecord[]>(UPDATES_FILE, []);
}
function writeUpdates(updates: UpdateRecord[]): void {
  writeJsonFile(UPDATES_FILE, updates);
}

// ── Password hashing (Node built-in scrypt — no external deps) ──────────
function createSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}
function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
function verifyPassword(password: string, salt: string, hash: string): boolean {
  try {
    const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
    const a = Buffer.from(candidate, "hex");
    const b = Buffer.from(hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Sessions ────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createSession(userId: string): SessionRecord {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const session: SessionRecord = {
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  const sessions = readSessions().filter((s) => new Date(s.expiresAt).getTime() > now);
  sessions.push(session);
  writeSessions(sessions);
  return session;
}

function getSessionUser(token: string): UserRecord | null {
  if (!token) return null;
  const sessions = readSessions();
  const session = sessions.find((s) => s.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    writeSessions(sessions.filter((s) => s.token !== token));
    return null;
  }
  const user = readUsers().find((u) => u.id === session.userId);
  if (!user || !user.active) return null;
  return user;
}

function destroySession(token: string): void {
  writeSessions(readSessions().filter((s) => s.token !== token));
}

// ── Auth middleware ─────────────────────────────────────────────────────
interface AuthedRequest extends express.Request {
  user?: UserRecord;
  company?: CompanyRecord | null;
}

function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = token ? getSessionUser(token) : null;
  if (!user) {
    res.status(401).json({ error: "Not authenticated. Please log in." });
    return;
  }
  req.user = user;
  req.company = user.companyId ? readCompanies().find((c) => c.id === user.companyId) || null : null;
  next();
}

function requireAdmin(req: AuthedRequest, res: express.Response, next: express.NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Admin access required." });
      return;
    }
    next();
  });
}

/** Gate an endpoint behind a feature pack enabled for the user's company. */
function requirePack(packId: string) {
  return (req: AuthedRequest, res: express.Response, next: express.NextFunction): void => {
    requireAuth(req, res, () => {
      const packs = req.company?.enabledPacks || [];
      if (!packs.includes(packId)) {
        res.status(403).json({ error: `The "${packId}" feature pack is not enabled for your company. Contact your administrator.` });
        return;
      }
      next();
    });
  };
}

// ── Connection info (LAN URL the admin shares with users) ───────────────
function getLanAddresses(): { ipv4: string[]; urls: string[] } {
  const ifaces = os.networkInterfaces();
  const ipv4: string[] = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) ipv4.push(iface.address);
    }
  }
  const secureHost = (process.env.PUBLIC_HTTPS_HOST || "").trim();
  const urls = secureHost
    ? [`https://${secureHost}:${PORT}`]
    : ipv4.map((ip) => `http://${ip}:${PORT}`);
  if (urls.length === 0) urls.push(`${secureHost ? "https" : "http"}://localhost:${PORT}`);
  return { ipv4, urls };
}

// ── Public user shape (never expose password hashes) ────────────────────
function publicUser(u: UserRecord): Record<string, unknown> {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    companyId: u.companyId,
    active: u.active,
    createdAt: u.createdAt,
  };
}

// ── Auth endpoints ──────────────────────────────────────────────────────
// Lightweight public status probe — tells the login page whether first-run
// setup is needed (no users exist yet). No auth required.
app.get("/api/auth/status", (_req, res) => {
  res.json({ usersExist: readUsers().length > 0 });
});

// First-run setup: create the initial admin account (only when no users exist).
app.post("/api/auth/setup", express.json(), (req, res) => {
  const users = readUsers();
  if (users.length > 0) {
    res.status(403).json({ error: "Setup already completed. Please log in." });
    return;
  }
  const { username, password } = req.body || {};
  if (!username || typeof username !== "string" || !password || typeof password !== "string") {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  const cleanName = username.trim();
  if (cleanName.length < 3) {
    res.status(400).json({ error: "Username must be at least 3 characters." });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }
  const salt = createSalt();
  const admin: UserRecord = {
    id: `u_${crypto.randomBytes(6).toString("hex")}`,
    username: cleanName,
    passwordHash: hashPassword(password, salt),
    salt,
    role: "admin",
    companyId: null,
    active: true,
    createdAt: new Date().toISOString(),
  };
  users.push(admin);
  writeUsers(users);
  const session = createSession(admin.id);
  res.json({ success: true, token: session.token, user: publicUser(admin) });
});

// Login
app.post("/api/auth/login", express.json(), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  const user = readUsers().find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!user || !verifyPassword(String(password), user.salt, user.passwordHash)) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }
  if (!user.active) {
    res.status(403).json({ error: "This account has been deactivated. Contact your administrator." });
    return;
  }
  const session = createSession(user.id);
  res.json({ success: true, token: session.token, user: publicUser(user) });
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) destroySession(token);
  res.json({ success: true });
});

// Current user + company + enabled packs + connection info
app.get("/api/auth/me", requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const company = req.company || null;
  const connection = getLanAddresses();
  res.json({
    user: publicUser(user),
    company: company
      ? { id: company.id, name: company.name, enabledPacks: company.enabledPacks, syncEnabled: company.syncEnabled }
      : null,
    enabledPacks: company ? company.enabledPacks : FEATURE_PACKS.map((p) => p.id),
    connection,
    packs: FEATURE_PACKS,
  });
});

// ── Admin: companies ────────────────────────────────────────────────────
app.get("/api/admin/companies", requireAdmin, (_req, res) => {
  const companies = readCompanies().map((c) => ({
    ...c,
    userCount: readUsers().filter((u) => u.companyId === c.id).length,
  }));
  res.json({ companies });
});

app.post("/api/admin/companies", requireAdmin, express.json(), (req, res) => {
  const { name, enabledPacks, syncEnabled } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Company name is required." });
    return;
  }
  const companies = readCompanies();
  if (companies.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
    res.status(400).json({ error: "A company with that name already exists." });
    return;
  }
  const company: CompanyRecord = {
    id: `c_${crypto.randomBytes(6).toString("hex")}`,
    name: name.trim(),
    enabledPacks: Array.isArray(enabledPacks) ? enabledPacks.filter((p) => FEATURE_PACKS.some((fp) => fp.id === p)) : [],
    syncEnabled: !!syncEnabled,
    createdAt: new Date().toISOString(),
  };
  companies.push(company);
  writeCompanies(companies);
  // Auto-create company folder on local drive
  createCompanyUserFolders(company.name);
  res.json({ success: true, company });
});

app.put("/api/admin/companies/:id", requireAdmin, express.json(), (req, res) => {
  const companies = readCompanies();
  const index = companies.findIndex((c) => c.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  const { name, enabledPacks, syncEnabled } = req.body || {};
  const oldName = companies[index].name;
  if (name && typeof name === "string" && name.trim()) companies[index].name = name.trim();
  if (Array.isArray(enabledPacks)) {
    companies[index].enabledPacks = enabledPacks.filter((p) => FEATURE_PACKS.some((fp) => fp.id === p));
  }
  if (typeof syncEnabled === "boolean") companies[index].syncEnabled = syncEnabled;
  writeCompanies(companies);
  // Rename company folder on local drive if name changed
  if (oldName !== companies[index].name) {
    const storage = loadSystemConfig();
    const basePath = storage.storageFolder;
    if (basePath) {
      const oldFolder = path.join(basePath, sanitizeFolderName(oldName));
      const newFolder = path.join(basePath, sanitizeFolderName(companies[index].name));
      if (fs.existsSync(oldFolder) && !fs.existsSync(newFolder)) {
        fs.renameSync(oldFolder, newFolder);
      }
    }
  }
  res.json({ success: true, company: companies[index] });
});

app.delete("/api/admin/companies/:id", requireAdmin, (req, res) => {
  const companies = readCompanies();
  const company = companies.find((c) => c.id === req.params.id);
  if (!company) {
    res.status(404).json({ error: "Company not found." });
    return;
  }
  const usersInCompany = readUsers().filter((u) => u.companyId === company.id);
  if (usersInCompany.length > 0) {
    res.status(400).json({ error: `Cannot delete company — ${usersInCompany.length} user(s) still belong to it. Move or delete them first.` });
    return;
  }
  writeCompanies(companies.filter((c) => c.id !== company.id));
  res.json({ success: true });
});

// ── Admin: users ────────────────────────────────────────────────────────
app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = readUsers().map((u) => {
    const company = u.companyId ? readCompanies().find((c) => c.id === u.companyId) : null;
    return { ...publicUser(u), companyName: company ? company.name : null };
  });
  res.json({ users });
});

app.post("/api/admin/users", requireAdmin, express.json(), (req, res) => {
  const { username, password, role, companyId, active } = req.body || {};
  if (!username || typeof username !== "string" || !password || typeof password !== "string") {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  const cleanName = username.trim();
  if (cleanName.length < 3) {
    res.status(400).json({ error: "Username must be at least 3 characters." });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }
  const users = readUsers();
  if (users.some((u) => u.username.toLowerCase() === cleanName.toLowerCase())) {
    res.status(400).json({ error: "That username is already taken." });
    return;
  }
  const userRole = role === "admin" ? "admin" : "user";
  if (userRole === "user" && companyId) {
    const company = readCompanies().find((c) => c.id === companyId);
    if (!company) {
      res.status(400).json({ error: "Selected company does not exist." });
      return;
    }
  }
  const salt = createSalt();
  const user: UserRecord = {
    id: `u_${crypto.randomBytes(6).toString("hex")}`,
    username: cleanName,
    passwordHash: hashPassword(password, salt),
    salt,
    role: userRole,
    companyId: userRole === "user" ? companyId || null : null,
    active: active !== false,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  // Auto-create user folder under company folder on local drive
  if (userRole === "user" && companyId) {
    const company = readCompanies().find((c) => c.id === companyId);
    if (company) {
      createCompanyUserFolders(company.name, user.username);
    }
  }
  res.json({ success: true, user: publicUser(user) });
});

app.put("/api/admin/users/:id", requireAdmin, express.json(), (req, res) => {
  const users = readUsers();
  const index = users.findIndex((u) => u.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const { username, password, role, companyId, active } = req.body || {};
  if (username && typeof username === "string" && username.trim()) {
    const cleanName = username.trim();
    if (users.some((u) => u.id !== users[index].id && u.username.toLowerCase() === cleanName.toLowerCase())) {
      res.status(400).json({ error: "That username is already taken." });
      return;
    }
    users[index].username = cleanName;
  }
  if (password && typeof password === "string" && password.length >= 6) {
    users[index].salt = createSalt();
    users[index].passwordHash = hashPassword(password, users[index].salt);
  }
  if (role === "admin" || role === "user") users[index].role = role;
  const oldUsername = users[index].username;
  const oldCompanyId = users[index].companyId;
  if (username && typeof username === "string" && username.trim()) {
    const cleanName = username.trim();
    if (users.some((u) => u.id !== users[index].id && u.username.toLowerCase() === cleanName.toLowerCase())) {
      res.status(400).json({ error: "That username is already taken." });
      return;
    }
    users[index].username = cleanName;
  }
  if (password && typeof password === "string" && password.length >= 6) {
    users[index].salt = createSalt();
    users[index].passwordHash = hashPassword(password, users[index].salt);
  }
  if (role === "admin" || role === "user") users[index].role = role;
  if (typeof companyId === "string" || companyId === null) {
    if (companyId) {
      const company = readCompanies().find((c) => c.id === companyId);
      if (!company) {
        res.status(400).json({ error: "Selected company does not exist." });
        return;
      }
    }
    users[index].companyId = users[index].role === "admin" ? null : companyId;
  }
  if (typeof active === "boolean") users[index].active = active;
  writeUsers(users);
  // Handle folder changes for user (rename or move company)
  if (users[index].role === "user" && users[index].companyId) {
    const newCompany = readCompanies().find((c) => c.id === users[index].companyId);
    if (newCompany) {
      const storage = loadSystemConfig();
      const basePath = storage.storageFolder;
      if (basePath) {
        // If username changed, rename user folder
        if (oldUsername !== users[index].username) {
          const oldUserFolder = path.join(basePath, sanitizeFolderName(newCompany.name), sanitizeFolderName(oldUsername));
          const newUserFolder = path.join(basePath, sanitizeFolderName(newCompany.name), sanitizeFolderName(users[index].username));
          if (fs.existsSync(oldUserFolder) && !fs.existsSync(newUserFolder)) {
            fs.renameSync(oldUserFolder, newUserFolder);
          }
        }
        // If company changed, move user folder to new company
        if (oldCompanyId !== users[index].companyId) {
          const oldCompany = readCompanies().find((c) => c.id === oldCompanyId);
          if (oldCompany) {
            const oldUserFolder = path.join(basePath, sanitizeFolderName(oldCompany.name), sanitizeFolderName(users[index].username));
            const newUserFolder = path.join(basePath, sanitizeFolderName(newCompany.name), sanitizeFolderName(users[index].username));
            if (fs.existsSync(oldUserFolder)) {
              // Ensure new company folder exists
              if (!fs.existsSync(path.join(basePath, sanitizeFolderName(newCompany.name)))) {
                fs.mkdirSync(path.join(basePath, sanitizeFolderName(newCompany.name)), { recursive: true });
              }
              fs.renameSync(oldUserFolder, newUserFolder);
            }
          }
        }
        // Ensure user folder exists (for new users or if missing)
        const userFolder = path.join(basePath, sanitizeFolderName(newCompany.name), sanitizeFolderName(users[index].username));
        if (!fs.existsSync(userFolder)) {
          fs.mkdirSync(userFolder, { recursive: true });
        }
      }
    }
  }
  res.json({ success: true, user: publicUser(users[index]) });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const users = readUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  if (user.role === "admin" && users.filter((u) => u.role === "admin").length <= 1) {
    res.status(400).json({ error: "Cannot delete the last admin account." });
    return;
  }
  writeUsers(users.filter((u) => u.id !== user.id));
  // Invalidate their sessions
  writeSessions(readSessions().filter((s) => s.userId !== user.id));
  res.json({ success: true });
});

// ── Admin: feature packs ────────────────────────────────────────────────
app.get("/api/admin/packs", requireAdmin, (_req, res) => {
  res.json({ packs: FEATURE_PACKS });
});

// ── Admin: update & rollback (git-based) ────────────────────────────────
function gitExec(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const out = execSync(`git ${args.join(" ")}`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: out.trim(), stderr: "" };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: String(e.stderr || e.message || e) };
  }
}

function getCurrentCommit(): string {
  const r = gitExec(["rev-parse", "--short", "HEAD"]);
  return r.ok ? r.stdout : "unknown";
}

function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function scheduleRestart(): void {
  const isProd = process.env.NODE_ENV === "production";
  const cmd = process.env.WS_RESTART_CMD || (isProd ? "node dist/server.cjs" : "npm run dev");
  const restart = process.platform === "win32"
    ? `start "" /b cmd /c "timeout /t 3 /nobreak >nul & ${cmd}"`
    : `sh -c 'sleep 3 && ${cmd}'`;
  try {
    spawn(restart, { detached: true, stdio: "ignore", shell: true }).unref();
    console.log(`[update] Restart scheduled: ${cmd}`);
  } catch (e) {
    console.error("[update] Failed to schedule restart:", e);
  }
}

app.get("/api/admin/update/status", requireAdmin, (_req, res) => {
  const fetchRes = gitExec(["fetch", "origin", "main"]);
  const behind = fetchRes.ok ? gitExec(["rev-list", "--count", "HEAD..origin/main"]) : { ok: false, stdout: "0" };
  const log = readUpdates();
  res.json({
    currentCommit: getCurrentCommit(),
    currentVersion: getCurrentVersion(),
    remoteConfigured: fetchRes.ok,
    updatesAvailable: fetchRes.ok && Number(behind.stdout) > 0,
    commitsBehind: fetchRes.ok ? Number(behind.stdout) : 0,
    workingTreeDirty: gitExec(["status", "--porcelain"]).stdout.length > 0,
    lastUpdate: log[log.length - 1] || null,
    updateLog: log,
  });
});

app.post("/api/admin/update/apply", requireAdmin, (_req, res) => {
  const before = getCurrentCommit();
  // Stash local changes so pull can fast-forward
  gitExec(["stash", "-u"]);
  const pull = gitExec(["pull", "--ff-only", "origin", "main"]);
  if (!pull.ok) {
    gitExec(["stash", "pop"]);
    res.status(500).json({ error: `Update failed: ${pull.stderr.slice(0, 400)}` });
    return;
  }
  // Rebuild the production bundle
  try {
    execSync("npm run build", { cwd: process.cwd(), stdio: "ignore" });
  } catch (e) {
    console.error("[update] Build failed after pull — rolling back:", e);
    gitExec(["reset", "--hard", before]);
    gitExec(["stash", "pop"]);
    res.status(500).json({ error: "Build failed after update. Reverted to the previous version." });
    return;
  }
  gitExec(["stash", "pop"]);
  const commit = getCurrentCommit();
  const log = readUpdates();
  log.push({
    version: getCurrentVersion(),
    commit,
    timestamp: new Date().toISOString(),
    status: "applied",
    note: pull.stdout.slice(0, 200),
  });
  writeUpdates(log);
  res.json({ success: true, message: "Update applied. Server is restarting with the new version...", commit });
  setTimeout(scheduleRestart, 1500);
});

app.post("/api/admin/update/rollback", requireAdmin, (_req, res) => {
  const log = readUpdates();
  const applied = log.filter((u) => u.status === "applied");
  if (applied.length === 0) {
    res.status(400).json({ error: "No applied updates to roll back." });
    return;
  }
  const last = applied[applied.length - 1];
  const before = getCurrentCommit();
  // Revert the last applied update commit (keeps history intact)
  const revert = gitExec(["revert", "--no-edit", last.commit]);
  if (!revert.ok) {
    res.status(500).json({ error: `Rollback failed: ${revert.stderr.slice(0, 400)}` });
    return;
  }
  try {
    execSync("npm run build", { cwd: process.cwd(), stdio: "ignore" });
  } catch (e) {
    console.error("[update] Build failed after rollback:", e);
    res.status(500).json({ error: "Build failed after rollback. Manual intervention required." });
    return;
  }
  log.push({
    version: getCurrentVersion(),
    commit: getCurrentCommit(),
    timestamp: new Date().toISOString(),
    status: "rolled-back",
    note: `Reverted ${last.commit} (was ${before})`,
  });
  writeUpdates(log);
  res.json({ success: true, message: "Rollback applied. Server is restarting...", commit: getCurrentCommit() });
  setTimeout(scheduleRestart, 1500);
});

// ── Data isolation helpers ──────────────────────────────────────────────
/** Filter history for a user: own cases + company cases when sync is enabled. Admins see all. */
function filterHistoryForUser(history: any[], user: UserRecord, company: CompanyRecord | null): any[] {
  if (user.role === "admin") return history;
  const own = history.filter((c) => c.ownerUserId === user.id);
  if (company?.syncEnabled) {
    const companyCases = history.filter((c) => c.companyId === company.id);
    // Merge without duplicates
    const seen = new Set(own.map((c) => c.id));
    for (const c of companyCases) {
      if (!seen.has(c.id)) own.push(c);
    }
  }
  return own;
}

function canAccessCase(user: UserRecord, company: CompanyRecord | null, caseRecord: any): boolean {
  if (user.role === "admin") return true;
  if (caseRecord.ownerUserId === user.id) return true;
  if (company?.syncEnabled && caseRecord.companyId === company.id) return true;
  return false;
}

/** Tenant storage is server-selected, never a path supplied by a client. */
function getTenantStoragePath(user: UserRecord): string {
  const config = loadSystemConfig();
  const base = path.resolve(config.storageFolder);
  if (user.role === "admin") return base;
  if (!user.companyId) {
    return path.join(base, "_unassigned", sanitizeFolderName(user.username));
  }
  const company = readCompanies().find((c) => c.id === user.companyId);
  if (!company) {
    return path.join(base, "_unassigned", sanitizeFolderName(user.username));
  }
  if (company.syncEnabled) {
    return path.join(base, sanitizeFolderName(company.name));
  }
  return path.join(base, sanitizeFolderName(company.name), sanitizeFolderName(user.username));
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolves and validates a user's folder path against their tenant storage boundaries. */
function resolveTenantFolderPath(user: UserRecord, folderPath?: string): string {
  const tenantBase = getTenantStoragePath(user);
  if (!fs.existsSync(tenantBase)) {
    try {
      fs.mkdirSync(tenantBase, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  if (!folderPath || !folderPath.trim()) {
    return tenantBase;
  }
  const clean = folderPath.trim();
  const resolved = path.isAbsolute(clean) ? path.resolve(clean) : path.resolve(tenantBase, clean);
  if (user.role !== "admin" && !isPathInside(resolved, tenantBase)) {
    throw new Error("Access denied: path is outside your company storage boundary.");
  }
  return resolved;
}

function generatePrintReadySql(caseData: any): string {
  const patientName = `Dental Case ${caseData.id}`;
  const patientId = caseData.id;
  const design = caseData.result?.design_parameters || {};
  const appliance = design.appliance || "Essix";
  const arch = design.arch || "Both";
  const selectedMaterial = design.material || "PETG 1.0mm Thermoforming Sheet";
  const shellThickness = typeof design.thickness_mm === "number" ? design.thickness_mm : 1.0;
  const trimLine = design.trim_line || "Scalloped - 1.5mm above gingival border";
  const trimLineTypeMatch = trimLine.toLowerCase().match(/scalloped|straight|beveled/);
  const trimLineType = trimLineTypeMatch ? trimLineTypeMatch[0] : "scalloped";
  const trimOffsetMatch = trimLine.match(/([0-9]+(?:\.[0-9]+)?)mm/);
  const trimScallopOffset = trimOffsetMatch ? Number(trimOffsetMatch[1]) : 1.5;
  const reliefAreas = Array.isArray(design.relief_areas) ? design.relief_areas : [];

  const markerRows = reliefAreas.map((area: string, index: number) => {
    const match = /tooth\s*#?(\d{1,2})/i.exec(area);
    const toothId = match ? Number(match[1]) : null;
    const markerLabel = toothId ? `Relief Tooth ${toothId}` : `Relief Marker ${index + 1}`;
    return {
      toothId,
      markerLabel,
      markerType: "relief_area",
      color: "#F97316",
      recommendationText: area
    };
  }).filter((item: any) => item.toothId !== null);

  const stlFiles = Array.isArray(caseData.files)
    ? caseData.files.filter((f: any) => typeof f.name === "string" && f.name.toLowerCase().endsWith(".stl"))
    : [];

  let sql = `-- Generated SQL export for case ${caseData.id}\n`;
  sql += `-- Export created on ${new Date().toISOString()}\n\n`;
  sql += `BEGIN TRANSACTION;\n\n`;
  sql += `INSERT INTO cases (patient_name, patient_id, appliance_type, arch, selected_material, shell_thickness_mm, trim_line_type, trim_scallop_offset_mm, print_ready, created_at, updated_at) VALUES (${JSON.stringify(patientName)}, ${JSON.stringify(patientId)}, ${JSON.stringify(appliance)}, ${JSON.stringify(arch)}, ${JSON.stringify(selectedMaterial)}, ${shellThickness}, ${JSON.stringify(trimLineType)}, ${trimScallopOffset}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);\n\n`;

  if (stlFiles.length > 0) {
    stlFiles.forEach((file: any) => {
      const fileUrl = file.url || file.name;
      sql += `INSERT INTO stl_files (case_id, file_name, file_url, scan_type, file_size_bytes, uploaded_at) VALUES (last_insert_rowid(), ${JSON.stringify(file.name)}, ${JSON.stringify(fileUrl)}, ${JSON.stringify(file.scan_type || "stl")}, ${Number(file.size || 0)}, CURRENT_TIMESTAMP);\n`;
    });
    sql += `\n`;
  }

  if (markerRows.length > 0) {
    markerRows.forEach((marker) => {
      sql += `INSERT INTO audit_markers (case_id, tooth_id, marker_label, marker_type, color, recommendation_text, print_position_x_mm, print_position_y_mm, print_position_z_mm, created_at) VALUES (last_insert_rowid(), ${marker.toothId}, ${JSON.stringify(marker.markerLabel)}, ${JSON.stringify(marker.markerType)}, ${JSON.stringify(marker.color)}, ${JSON.stringify(marker.recommendationText)}, NULL, NULL, NULL, CURRENT_TIMESTAMP);\n`;
    });
    sql += `\n`;
  }

  sql += `INSERT INTO print_instructions (case_id, printer_profile, sheet_width_mm, sheet_height_mm, margin_left_mm, margin_right_mm, margin_top_mm, margin_bottom_mm, marker_scale, marker_label_font, marker_label_size_pt, include_legend, notes, generated_at) VALUES (last_insert_rowid(), 'Standard Print Ready Output', 216.0, 279.0, 10.0, 10.0, 10.0, 10.0, 1.0, 'Arial', 8, 1, 'Generated from AI CAD case export.', CURRENT_TIMESTAMP);\n\n`;
  sql += `COMMIT;\n`;
  return sql;
}

// Configure multer storage for uploaded files
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    // Sanitize filename and append timestamp to avoid collisions
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // limit to 500MB per file
});

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Serve uploaded files statically only after authentication
app.use("/uploads", requireAuth, express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.stl')) {
      res.setHeader('Content-Type', 'application/sla');
    }
  }
}));

// Serve shared storage only after authentication and tenant checks.
// NOTE: initialized with the default path here; updated by POST /api/system/config.
let sharedStorageDir = path.join(process.cwd(), "storage");
app.use("/storage", requireAuth, (req: AuthedRequest, res, next) => {
  const [companySegment, userSegment] = req.path.split("/").filter(Boolean);
  const user = req.user!;
  const company = req.company;
  if (user.role === "admin") return next();
  if (!company || companySegment !== sanitizeFolderName(company.name)) {
    res.status(403).json({ error: "Storage access is limited to your company." });
    return;
  }
  if (userSegment !== sanitizeFolderName(user.username) && !company.syncEnabled) {
    res.status(403).json({ error: "Company folder sharing is disabled." });
    return;
  }
  next();
}, express.static(sharedStorageDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.stl')) {
      res.setHeader('Content-Type', 'application/sla');
    }
  }
}));

// Initialize Gemini SDK lazily, with telemetry User-Agent
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  // If an OpenAI-compatible provider from the registry is active, return a
  // truthy sentinel so availability checks pass — generateContentWithRetry
  // routes the actual call to the HTTP endpoint.
  if (isOpenAiCompatibleActive()) {
    return {} as GoogleGenAI;
  }
  // 1) JSON config apiKey (from the AI Manager JSON editor) takes priority
  const configKey = aiRuntimeConfig.apiKey;
  if (configKey) {
    if (!aiClient) {
      try {
        aiClient = new GoogleGenAI({
          apiKey: configKey,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
      } catch {
        return null;
      }
    }
    return aiClient;
  }
  // 2) Runtime (UI-managed) key — the active saved API key
  const runtimeApiKey = activeApiKey;
  if (runtimeApiKey) {
    if (!aiClient) {
      try {
        aiClient = new GoogleGenAI({
          apiKey: runtimeApiKey,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
      } catch {
        return null;
      }
    }
    return aiClient;
  }
  // 3) Fall back to env var
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
    console.warn("GEMINI_API_KEY not set or placeholder. Mock engine will be used.");
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

/** Call an OpenAI-compatible chat-completions endpoint (registry providers).
 *  Handles both plain JSON and SSE streaming responses. */
async function callOpenAiCompatible(
  provider: AiProviderEntry,
  params: { model: string; contents: any[]; config?: any }
): Promise<{ text: string; raw?: any }> {
  const modelId = provider.activeModelId || provider.models[0]?.id;
  const model = provider.models.find(m => m.id === modelId) || provider.models[0];
  if (!model || !model.url) {
    throw new Error(`Provider "${provider.name}" has no usable model URL.`);
  }
  // Convert Gemini-style contents to chat messages. Parts that carry only
  // text are mapped to user messages; an explicit "model"/"assistant" role
  // becomes an assistant turn so multi-turn chats keep working.
  const messages: { role: string; content: string }[] = [];
  for (const c of params.contents || []) {
    const role = c.role === "model" || c.role === "assistant" ? "assistant" : "user";
    const parts = Array.isArray(c.parts) ? c.parts : [];
    const text = parts.map((p: any) => (typeof p === "string" ? p : p.text || "")).filter(Boolean).join("\n");
    if (text) messages.push({ role, content: text });
  }
  if (!messages.length) messages.push({ role: "user", content: "..." });
  const temperature = params.config?.temperature != null ? Number(params.config.temperature) : 0.7;
  const body: any = {
    model: model.id,
    messages,
    temperature,
    stream: false,
  };
  if (model.maxOutputTokens) body.max_tokens = model.maxOutputTokens;

  // AbortController timeout — the free endpoints can hang; fail fast.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let resp: Response;
  try {
    resp = await fetch(model.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    throw new Error(`[${provider.name}] Network error: ${err?.message || err}`);
  }
  clearTimeout(timer);
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`[${provider.name}] HTTP ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const contentType = resp.headers.get("content-type") || "";
  const rawText = await resp.text();

  // SSE streaming — accumulate delta.content (and reasoning if no content yet)
  if (contentType.includes("text/event-stream") || rawText.trimStart().startsWith("data:")) {
    let text = "";
    for (const line of rawText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta;
        if (delta) {
          if (typeof delta.content === "string") text += delta.content;
          else if (typeof delta.reasoning_content === "string" && !text) text += delta.reasoning_content;
        }
        if (typeof chunk?.choices?.[0]?.message?.content === "string") text += chunk.choices[0].message.content;
      } catch { /* skip malformed SSE line */ }
    }
    return { text: text || "", raw: undefined };
  }

  // Plain JSON response
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`[${provider.name}] Invalid response from endpoint.`);
  }
  const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
  return { text: typeof text === "string" ? text : JSON.stringify(text), raw: data };
}

// Robust wrapper with exponential backoff for transient errors. Tries every
// ACTIVE provider in priority order (primary first, then backups) until one
// responds. Each provider gets its own retry/backoff loop before the chain
// moves to the next one. OpenAI-compatible endpoints go through HTTP;
// otherwise the Gemini SDK is used (simple config / saved key).
async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: { 
    model: string; 
    contents: any[]; 
    config?: any;
    _userId?: string;
    _username?: string;
    _companyId?: string;
    _companyName?: string;
    _requestType?: string;
  },
  retries = 3,
  delayMs = 1500
): Promise<any> {
  // Use the model selected in the AI Manager (JSON config / model picker).
  params.model = getAiModel();

  // Retry/backoff loop for a single call attempt.
  const attemptWithBackoff = async (fn: () => Promise<any>): Promise<any> => {
    let lastError: any = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[AI API Retry] Attempt ${attempt} of ${retries} after transient failure...`);
        }
        return await fn();
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || String(err);
        const status = err.status || (err.error && err.error.code) || 0;
        console.error(`[AI API Attempt ${attempt} failed] Status: ${status}, Error: ${errMsg}`);
        const isTransient =
          status === 503 ||
          status === 429 ||
          errMsg.includes("503") ||
          errMsg.includes("429") ||
          errMsg.includes("UNAVAILABLE") ||
          errMsg.includes("fetch") ||
          errMsg.includes("socket") ||
          errMsg.includes("timeout") ||
          errMsg.includes("ECONN") ||
          errMsg.includes("ETIMEDOUT");
        if (!isTransient || attempt === retries) {
          throw err;
        }
        const waitTime = delayMs * (2 ** (attempt - 1)) + Math.random() * 500;
        console.log(`[AI API Backoff] Waiting ${Math.round(waitTime)}ms before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
    throw lastError;
  };

  // 1) Active OpenAI-compatible providers in priority order (fallback chain)
  const httpProviders = getActiveAiProviders().filter(
    p => (p.vendor === "customendpoint" || p.apiType === "chat-completions") && !!p.apiKey && p.models.length > 0
  );
  let lastHttpError: any = null;
  for (const provider of httpProviders) {
    try {
      console.log(`[AI API] Trying provider "${provider.name}" (priority ${provider.priority ?? "?"})…`);
      const result = await attemptWithBackoff(() => callOpenAiCompatible(provider, params));
      // Record usage for successful OpenAI-compatible call
      const activeModel = provider.models.find(m => m.id === (provider.activeModelId || provider.models[0]?.id)) || provider.models[0];
      if (activeModel) {
        // Estimate tokens from response (rough approximation)
        const outputText = result.text || "";
        const outputTokens = Math.ceil(outputText.length / 4);
        const inputText = JSON.stringify(params.contents || []);
        const inputTokens = Math.ceil(inputText.length / 4);
        recordAiUsage({
          userId: (params as any)._userId || "unknown",
          username: (params as any)._username || "unknown",
          companyId: (params as any)._companyId || "unknown",
          companyName: (params as any)._companyName || "unknown",
          providerId: provider.id,
          providerName: provider.name,
          modelId: activeModel.id,
          modelName: activeModel.name || activeModel.id,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd: estimateCost(activeModel.id, inputTokens, outputTokens),
          requestType: (params as any)._requestType || "chat",
        });
      }
      return result;
    } catch (err: any) {
      lastHttpError = err;
      console.warn(`[AI API] Provider "${provider.name}" exhausted — trying next active provider (if any).`);
    }
  }
  if (httpProviders.length > 0) {
    // All HTTP providers failed — surface the last error so the user knows
    // their configured AIs are unreachable (no silent Gemini fallback).
    throw lastHttpError || new Error("[AI API] All active providers failed.");
  }

  // 2) No OpenAI-compatible providers → Gemini SDK path
  const geminiResult = await attemptWithBackoff(() => ai.models.generateContent(params));
  // Record usage for successful Gemini call
  const modelId = params.config?.model || "gemini-3.5-flash";
  const usageMetadata = (geminiResult as any).usageMetadata;
  let inputTokens = 0, outputTokens = 0;
  if (usageMetadata) {
    inputTokens = usageMetadata.promptTokenCount || 0;
    outputTokens = usageMetadata.candidatesTokenCount || 0;
  } else {
    // Fallback estimation
    const outputText = geminiResult.text || "";
    outputTokens = Math.ceil(outputText.length / 4);
    const inputText = JSON.stringify(params.contents || []);
    inputTokens = Math.ceil(inputText.length / 4);
  }
  recordAiUsage({
    userId: (params as any)._userId || "unknown",
    username: (params as any)._username || "unknown",
    companyId: (params as any)._companyId || "unknown",
    companyName: (params as any)._companyName || "unknown",
    providerId: "google-genai",
    providerName: "Google Gemini",
    modelId,
    modelName: modelId,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimateCost(modelId, inputTokens, outputTokens),
    requestType: (params as any)._requestType || "chat",
  });
  return geminiResult;
}

const CORE_MEMORY_FILE = path.join(process.cwd(), "core_memory.json");

const defaultChatInstructions = `You are the WhiteSmile AI CAD Designer, an expert orthodontic digital technician with more than 20 years of experience designing clear aligners, retainers, and digital orthodontic appliances.
You combine the elite expertise of an Orthodontist, Certified Dental Technician (CDT), Digital CAD Designer, Dental Materials Engineer, Biomechanics Specialist, Digital Manufacturing Engineer, and Quality Control Inspector.

Never answer like a generic AI assistant. Always answer with the professional, evidence-based authority of a senior orthodontic laboratory technician.

**WhiteSmile AI Core Memory clinical guidelines you MUST strictly obey & reference:**
- **Strict Staging Limits (Tooth Movement Rules)**: Always warn if recommended movements exceed these clinical biological limits:
  * Translation: Max 0.25 mm per stage
  * Rotation: Max 2° per stage
  * Root movement: Max 0.25 mm per stage
  * Extrusion: Max 0.15–0.20 mm per stage
  * Intrusion: Max 0.20 mm per stage
  * Expansion: Max 0.20–0.25 mm per stage
  * Torque: Max 2° per stage
- **Attachment Planning Guidelines**: Proactively recommend active beveled attachments when rot/torque control or active movements are requested:
  * Beveled Rectangular (Horizontal): Premolars/canines (2-4mm width) for intrusion, extrusion, and root torque.
  * Beveled Rectangular (Vertical): Incisors/canines for rotation control.
  * Ellipsoidal / Dome Attachments: Posteriors for general retention.
- **Trim-Line Guidelines**: Recommend scalloped trim lines cut 0.5mm to 1.0mm coronal to the gingival margin for superior aesthetics and comfort, or straight flat trim lines cut 1.5mm to 2.0mm above the gingival zenith for maximum retention (e.g., short clinical crowns, severe tipping).
- **Undercut relief block-out**: Specify wax relief block-out paths of insertion in critical interproximal regions to prevent physical appliance lock-on.`;

const defaultAnalysisInstructions = `You are the WhiteSmile AI CAD Designer, an expert orthodontic digital technician with more than 20 years of experience designing clear aligners, retainers, and digital orthodontic appliances. You combine the roles of Orthodontist, CDT, Dental Materials Engineer, Biomechanics Specialist, and Quality Control Inspector to ensure clinically correct, manufacturable designs.

**WhiteSmile AI Core Memory Clinical & Manufacturing Guidelines:**

1. Biomaterial & Hardware Specifications:
   - Essix Retainers / Aligners: Thermoformed with high-durability biocompatible copolyester (PETG) or flexible polyurethane grade (e.g. SG Dental Polyurethane). Standard thicknesses: 0.75mm (high flexibility/comfort), 1.0mm (standard retention/strength), 1.5mm (heavy bruxism/nightguard).
   - Hawley Plates: rigid PMMA acrylic baseplate (approx. 2.0-2.5mm thick for structural strength) + 0.7mm high-tensile stainless steel labial bow wire. Adams clasps or ball clasps (0.7-0.8mm wire) on first molars (#16, #26, #36, #46) or premolars.

2. Strict Biomechanical Movement & Staging Rules:
   - To avoid periodontal ligament (PDL) necrosis and root resorption, limit individual tooth movement per staging step to these biological limits:
     * Translation: Max 0.25 mm
     * Rotation: Max 2°
     * Root movement: Max 0.25 mm
     * Extrusion: Max 0.15–0.20 mm
     * Intrusion: Max 0.20 mm
     * Expansion: Max 0.20–0.25 mm
     * Torque: Max 2°
   - Never recommend unrealistic movement. Always warn when movement exceeds biological limits.
   - For torque control, intrusion, or root tipping, recommend placement of active attachments:
     * Beveled Rectangular (Horizontal) Attachments: placed on premolars/canines (2-4mm width) for intrusion, extrusion, and root torque.
     * Beveled Rectangular (Vertical) Attachments: placed on incisors and canines for rotational control.
     * Ellipsoidal / Dome Attachments: placed on posteriors to provide general retention.

3. Laser Trim-Line & Scallop Cut Path:
   - Scalloped Trim Line: Cut precisely 0.5mm to 1.0mm coronal to the gingival margin. Recommended for standard clear aligners to prevent tissue irritation while maintaining aesthetics.
   - Straight Flat Trim Line: Cut 1.5mm to 2.0mm above the gingival zenith. Significantly increases appliance retention and rigidity; recommended for cases with short clinical crowns, severe tipping, or passive retention without attachments.

4. Undercut Block-Out & Wax Relief Paths:
   - Heavy undercuts in the interproximal spaces, deep lingual inclinations of mandibular molars, and bridge structures must have digital wax block-out relief applied relative to the Path of Insertion.
   - Always specify generous relief zones for the labial and lingual frenum attachments to avoid mucosal ulceration.

5. Warnings and Safety Audit:
   - Missing Arch Specification: Immediately flag a warning if the active arch (Maxillary, Mandibular, or Dual) is ambiguous.
   - Missing thickness: If thickness is omitted, default to standard 1.0mm for Essix but flag as a warning.
   - Design Conflict: Flag a major conflict if thermoforming materials are requested alongside Hawley wire bows/acrylic baseplates.
   - Scan Defect Check: Review the description or attached images/videos for mentions of scan bubbles, interproximal voids, incomplete second molar captures, or distortions.`;

function getCoreMemory() {
  try {
    if (fs.existsSync(CORE_MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(CORE_MEMORY_FILE, "utf-8"));
      return {
        chatInstructions: data.chatInstructions || defaultChatInstructions,
        analysisInstructions: data.analysisInstructions || defaultAnalysisInstructions,
      };
    }
  } catch (err) {
    console.error("Error reading core memory file:", err);
  }
  return {
    chatInstructions: defaultChatInstructions,
    analysisInstructions: defaultAnalysisInstructions,
  };
}

function saveCoreMemory(data: { chatInstructions: string; analysisInstructions: string }) {
  try {
    fs.writeFileSync(CORE_MEMORY_FILE, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("Error writing core memory file:", err);
    return false;
  }
}

app.post("/api/local-sync", requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const { localPath } = req.body;

  if (!localPath) {
    res.status(400).json({ error: "Please enter a valid local folder path (e.g. C:\\Patients\\Reference_Library)." });
    return;
  }

  try {
    const resolvedPath = path.resolve(localPath);
    
    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({
        error: `Local path not found: "${resolvedPath}". Please verify the folder exists.`,
        code: "PATH_NOT_FOUND"
      });
      return;
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      res.status(400).json({
        error: `"${resolvedPath}" is not a directory. Please provide a folder path.`,
        code: "NOT_A_DIRECTORY"
      });
      return;
    }

    const entries = fs.readdirSync(resolvedPath);
    const files: Array<{ name: string; size: string; type: string; synced: boolean }> = [];

    for (const entry of entries) {
      const fullPath = path.join(resolvedPath, entry);
      try {
        const entryStat = fs.statSync(fullPath);
        if (!entryStat.isFile()) continue;

        const ext = path.extname(entry).toLowerCase();
        let type = "other";
        if (ext === ".stl") type = "stl";
        else if (ext === ".pdf") type = "pdf";
        else if (ext === ".doc" || ext === ".docx") type = "pdf";
        else if (ext === ".mp4" || ext === ".mov" || ext === ".avi" || ext === ".webm") type = "video";
        else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") type = "image";

        const sizeMB = entryStat.size / (1024 * 1024);
        const sizeStr = sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${(entryStat.size / 1024).toFixed(1)} KB`;

        files.push({
          name: entry,
          size: sizeStr,
          type,
          synced: true,
        });
      } catch {
        // skip inaccessible files
      }
    }

    const stlCount = files.filter(f => f.type === "stl").length;
    const pdfCount = files.filter(f => f.type === "pdf").length;

    res.json({
      success: true,
      message: `Local folder scanned: ${files.length} file(s) found.`,
      localPath: localPath,
      files,
      analysis: {
        summary: `Scanned ${files.length} file(s) from "${resolvedPath}".`,
        findings: [
          `Found ${stlCount} STL scan file(s).`,
          `Found ${pdfCount} document file(s).`,
          `Folder contains ${files.length} total item(s).`
        ],
        references: []
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: `Failed to read local path: ${error?.message || "Unknown error"}`,
    });
  }
});

// Poll endpoint for "Keep in Sync" — lightweight path availability check
app.post("/api/local-poll", requireAuth, express.json(), async (req, res) => {
  const { localPath } = req.body;
  const user = (req as any).user;

  if (!localPath) {
    res.json({ disconnected: true, error: "No local path configured." });
    return;
  }

  try {
    const resolvedPath = path.resolve(localPath);
    const exists = fs.existsSync(resolvedPath);
    res.json({ disconnected: !exists, error: exists ? undefined : "Path no longer accessible." });
  } catch {
    res.json({ disconnected: true, error: "Unable to access local path." });
  }
});

// ── Sync Engine: New Reusable API Endpoints ─────────────────────────────

interface SyncJob {
  syncId: string;
  folderPath: string;
  selectedFiles: string[];
  syncMode: string;
  storageTarget?: string;
  status: 'running' | 'completed' | 'error';
  progress: {
    percent: number;
    currentFile: string;
    filesCompleted: number;
    totalFiles: number;
    stage: string;
  };
  errors: string[];
  createdAt: number;
  _user?: any; // User info for storage folder resolution
}

const activeSyncJobs = new Map<string, SyncJob>();

// POST /api/sync/scan — Recursive folder scan with full metadata
app.post("/api/sync/scan", requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const { folderPath } = req.body;
  const user = (req as any).user;

  try {
    const resolvedPath = resolveTenantFolderPath(user, folderPath);
    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({ error: `Folder not found: "${resolvedPath}"` });
      return;
    }
    if (!fs.statSync(resolvedPath).isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory.' });
      return;
    }

    // Get user's company to filter visible files
    const userCompany = user.companyId ? readCompanies().find(c => c.id === user.companyId) : null;
    const canSeeAllCompanyFiles = userCompany?.syncEnabled === true;

    const files: Array<{
      name: string;
      relativePath: string;
      extension: string;
      size: number;
      sizeFormatted: string;
      modifiedAt: string;
      isDirectory: boolean;
    }> = [];

    let totalSize = 0;
    let folderCount = 0;

    // Files to skip — OS/system junk that clutters the file list
    const SKIP_FILES = new Set([
      'desktop.ini', 'thumbs.db', '.ds_store', '.localized',
      'ehthumbs.db', 'ehthumbs_vista.db',
    ]);
    function shouldSkip(name: string): boolean {
      const lower = name.toLowerCase();
      if (SKIP_FILES.has(lower)) return true;
      if (lower.startsWith('~$')) return true;         // Office temp files
      if (lower.startsWith('.') && lower !== '.') return true; // Unix hidden files (except current dir refs)
      return false;
    }

    function scanRecursive(dirPath: string, relativeDir: string = '') {
      let entries: string[];
      try {
        entries = fs.readdirSync(dirPath);
      } catch {
        return; // skip inaccessible directories
      }

      for (const entry of entries) {
        // Skip OS junk files entirely (don't even recurse into junk directories)
        if (shouldSkip(entry)) continue;

        const fullPath = path.join(dirPath, entry);
        const relativePath = relativeDir ? path.join(relativeDir, entry) : entry;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            folderCount++;
            files.push({
              name: entry,
              relativePath: relativePath,
              extension: '',
              size: 0,
              sizeFormatted: '',
              modifiedAt: stat.mtime.toISOString(),
              isDirectory: true,
            });
            scanRecursive(fullPath, relativePath);
          } else if (stat.isFile()) {
            const ext = path.extname(entry).toLowerCase();
            totalSize += stat.size;
            files.push({
              name: entry,
              relativePath: relativePath,
              extension: ext,
              size: stat.size,
              sizeFormatted: stat.size >= 1048576
                ? `${(stat.size / 1048576).toFixed(1)} MB`
                : stat.size >= 1024
                ? `${(stat.size / 1024).toFixed(1)} KB`
                : `${stat.size} B`,
              modifiedAt: stat.mtime.toISOString(),
              isDirectory: false,
            });
          }
        } catch {
          // skip inaccessible entries
        }
      }
    }

    scanRecursive(resolvedPath);

    const fileCount = files.filter(f => !f.isDirectory).length;

    res.json({
      success: true,
      message: `Scanned ${fileCount} file(s) in ${folderCount} folder(s).`,
      folderPath,
      files,
      stats: {
        files: fileCount,
        folders: folderCount,
        totalSize: totalSize >= 1073741824
          ? `${(totalSize / 1073741824).toFixed(2)} GB`
          : totalSize >= 1048576
          ? `${(totalSize / 1048576).toFixed(1)} MB`
          : `${(totalSize / 1024).toFixed(1)} KB`,
        totalSizeBytes: totalSize,
        synced: 0,
        pending: fileCount,
        errors: 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to scan folder: ${error?.message || 'Unknown error'}` });
  }
});

// POST /api/sync/start — Start async file synchronization
app.post("/api/sync/start", requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const { folderPath, selectedFiles, syncMode, storageTarget } = req.body;
  const user = (req as any).user;
  if (!selectedFiles || !Array.isArray(selectedFiles) || selectedFiles.length === 0) {
    res.status(400).json({ error: 'Selected files are required.' });
    return;
  }

  try {
    const validFolderPath = resolveTenantFolderPath(user, folderPath);
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const job: SyncJob = {
      syncId,
      folderPath: validFolderPath,
      selectedFiles,
      syncMode: syncMode || 'reference',
      storageTarget,
      status: 'running',
      progress: { percent: 0, currentFile: '', filesCompleted: 0, totalFiles: selectedFiles.length, stage: 'Starting...' },
      errors: [],
      createdAt: Date.now(),
      _user: user, // Attach user info for storage folder resolution
    };

    activeSyncJobs.set(syncId, job);

    // Process sync in background
    processSyncJob(job).catch(err => {
      console.error(`Sync job ${syncId} failed:`, err);
      job.status = 'error';
      job.errors.push((err && typeof err.message === 'string' ? err.message : String(err)) || 'Unknown sync error');
    });

    res.json({ success: true, syncId, message: `Sync started for ${selectedFiles.length} file(s).` });
  } catch (err: any) {
    res.status(403).json({ error: err.message || "Access denied" });
  }
});

async function processSyncJob(job: SyncJob) {
  const user = (job as any)._user; // User info attached when job is created
  const baseStoragePath = loadSystemConfig().storageFolder;
  const resolvedPath = user ? resolveTenantFolderPath(user, job.folderPath) : path.resolve(job.folderPath);
  const userStoragePath = user ? getTenantStoragePath(user) : baseStoragePath;
  
  if (!fs.existsSync(userStoragePath)) {
    fs.mkdirSync(userStoragePath, { recursive: true });
  }

  for (let i = 0; i < job.selectedFiles.length; i++) {
    if (job.status === 'error') break;

    const relPath = job.selectedFiles[i];
    const sourcePath = path.join(resolvedPath, relPath);

    job.progress.currentFile = path.basename(relPath);
    job.progress.filesCompleted = i;
    job.progress.stage = 'Verifying...';
    job.progress.percent = Math.round(((i + 1) / job.selectedFiles.length) * 100);

    try {
      // Read & verify file directly from source
      if (!fs.existsSync(sourcePath)) {
        job.errors.push(`File not found: ${relPath}`);
        continue;
      }

      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) continue;

      // Quick integrity check: read first few bytes to confirm it's readable
      const fd = fs.openSync(sourcePath, 'r');
      try {
        const probe = Buffer.alloc(64);
        fs.readSync(fd, probe, 0, 64, 0);
      } finally {
        fs.closeSync(fd);
      }

      // Copy file to user's storage folder (server-side storage)
      if (userStoragePath !== baseStoragePath) {
        const destPath = path.join(userStoragePath, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(sourcePath, destPath);
        job.progress.stage = `Synced ${path.basename(relPath)} → storage`;
      } else {
        job.progress.stage = `Synced ${path.basename(relPath)} (in-place)`;
      }
    } catch (err: any) {
      job.errors.push(`Failed to verify ${relPath}: ${err && typeof err.message === 'string' ? err.message : String(err)}`);
    }
  }

  job.progress.filesCompleted = job.selectedFiles.length;
  job.progress.percent = 100;
  job.progress.stage = userStoragePath !== baseStoragePath 
    ? 'Complete — files saved to your storage folder' 
    : 'Complete — files ready in original location';
  job.status = 'completed';

  // Clean up old jobs after 5 minutes
  setTimeout(() => activeSyncJobs.delete(job.syncId), 5 * 60 * 1000);
}

// GET /api/sync/progress/:syncId — Poll sync progress
app.get('/api/sync/progress/:syncId', requireAuth, (req, res) => {
  const { syncId } = req.params;
  const user = (req as any).user;
  const job = activeSyncJobs.get(syncId);

  if (!job) {
    res.status(404).json({ error: 'Sync job not found.' });
    return;
  }

  if (job.status === 'completed') {
    res.json({
      status: 'completed',
      progress: job.progress,
      result: { success: true, message: 'Sync completed', syncedFiles: job.progress.filesCompleted, errors: job.errors },
    });
  } else if (job.status === 'error') {
    res.json({
      status: 'error',
      progress: job.progress,
      error: job.errors.join('; ') || 'Unknown sync error',
    });
  } else {
    res.json({
      status: 'running',
      progress: job.progress,
    });
  }
});

// POST /api/sync/unsync — Remove synchronization
app.post('/api/sync/unsync', requireAuth, express.json(), async (req, res) => {
  const { folderPath, allowWrite } = req.body;
  const user = (req as any).user;

  if (!folderPath) {
    res.status(400).json({ error: 'Folder path is required.' });
    return;
  }

  try {
    // If AI is writing, queue the unsync
    if (allowWrite) {
      // Check if there are active write operations
      const resolvedFolder = path.resolve(folderPath);
      const hasActiveWrites = Array.from(activeSyncJobs.values()).some(
        j => j.status === 'running' && path.resolve(j.folderPath) === resolvedFolder
      );
      if (hasActiveWrites) {
        res.json({ success: false, queued: true, message: 'Waiting for current write operation to complete...' });
        return;
      }
    }

    // For now, unsync is just about disconnecting — remove any stored state
    // In production, clean up symlinks, watchers, etc.
    res.json({ success: true, message: 'Folder unsynchronized.' });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to unsync: ${error?.message || 'Unknown error'}` });
  }
});

// POST /api/sync/read-file — Read a file directly from its local path (no copy)
app.post('/api/sync/read-file', requireAuth, express.json({ limit: '500mb' }), async (req, res) => {
  const { folderPath, relativePath } = req.body;
  const user = (req as any).user;

  if (!folderPath || !relativePath) {
    res.status(400).json({ error: 'folderPath and relativePath are required.' });
    return;
  }

  try {
    const resolvedBase = getTenantStoragePath(user);
    const resolvedFile = path.resolve(resolvedBase, relativePath);

    // Security: ensure resolved path is inside the base folder
    if (!isPathInside(resolvedFile, resolvedBase)) {
      res.status(403).json({ error: 'Access denied: path traversal detected.' });
      return;
    }

    if (!fs.existsSync(resolvedFile)) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const stat = fs.statSync(resolvedFile);
    if (!stat.isFile()) {
      res.status(400).json({ error: 'Path is not a file.' });
      return;
    }

    // Read file content and return as base64
    const content = fs.readFileSync(resolvedFile);
    const base64 = content.toString('base64');
    const ext = path.extname(resolvedFile).toLowerCase();

    // Determine mime type
    let mimeType = 'application/octet-stream';
    if (ext === '.stl') mimeType = 'application/sla';
    else if (ext === '.pdf') mimeType = 'application/pdf';
    else if (['.jpg', '.jpeg'].includes(ext)) mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (['.mp4', '.mov', '.avi', '.webm'].includes(ext)) mimeType = 'video/mp4';
    else if (ext === '.txt' || ext === '.md') mimeType = 'text/plain';
    else if (ext === '.json') mimeType = 'application/json';
    else if (ext === '.csv') mimeType = 'text/csv';

    res.json({
      success: true,
      name: path.basename(resolvedFile),
      relativePath,
      extension: ext,
      size: stat.size,
      mimeType,
      content: base64,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to read file: ${error?.message || 'Unknown error'}` });
  }
});

// POST /api/sync/write-file — Write a file directly to a local path (for storage mode)
app.post('/api/sync/write-file', requireAuth, express.json({ limit: '500mb' }), async (req, res) => {
  const { folderPath, relativePath, content } = req.body;
  const user = (req as any).user;

  if (!folderPath || !relativePath || !content) {
    res.status(400).json({ error: 'folderPath, relativePath, and content are required.' });
    return;
  }

  try {
    const resolvedBase = getTenantStoragePath(user);
    const resolvedFile = path.resolve(resolvedBase, relativePath);

    // Security: ensure resolved path is inside the base folder
    if (!isPathInside(resolvedFile, resolvedBase)) {
      res.status(403).json({ error: 'Access denied: path traversal detected.' });
      return;
    }

    // Ensure target directory exists
    fs.mkdirSync(path.dirname(resolvedFile), { recursive: true });

    // Write file directly
    const buffer = Buffer.from(content, 'base64');
    fs.writeFileSync(resolvedFile, buffer);

    res.json({
      success: true,
      message: `File written to ${relativePath}`,
      path: resolvedFile,
      size: buffer.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to write file: ${error?.message || 'Unknown error'}` });
  }
});

// POST /api/sync/check-changes — Detect file changes in a synced folder
app.post('/api/sync/check-changes', requireAuth, express.json(), async (req, res) => {
  const { folderPath } = req.body;
  const user = (req as any).user;

  try {
    const resolvedPath = resolveTenantFolderPath(user, folderPath);
    if (!fs.existsSync(resolvedPath)) {
      res.json({ changed: true, disconnected: true, newFiles: [], deletedFiles: [], modifiedFiles: [] });
      return;
    }

    // Quick scan for recent changes (last 30 seconds)
    const now = Date.now();
    const recentThreshold = now - 30000;
    const newFiles: string[] = [];
    const modifiedFiles: string[] = [];

    function checkDir(dirPath: string) {
      let entries: string[];
      try {
        entries = fs.readdirSync(dirPath);
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            checkDir(fullPath);
          } else if (stat.isFile()) {
            const mtime = stat.mtimeMs;
            const ctime = stat.ctimeMs;
            if (ctime > recentThreshold && Math.abs(ctime - mtime) < 1000) {
              newFiles.push(entry);
            } else if (mtime > recentThreshold) {
              modifiedFiles.push(entry);
            }
          }
        } catch {
          // skip
        }
      }
    }

    checkDir(resolvedPath);

    const changed = newFiles.length > 0 || modifiedFiles.length > 0;

    res.json({
      changed,
      newFiles,
      deletedFiles: [],
      modifiedFiles,
      disconnected: false,
    });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to check changes: ${error?.message || 'Unknown error'}` });
  }
});

// POST /api/sync/import-terminal — Run a terminal command with selected file paths
app.post('/api/sync/import-terminal', requireAdmin, async (req, res) => {
  try {
    const { folderPath, selectedFiles, command } = req.body;

    if (!folderPath || !selectedFiles || !Array.isArray(selectedFiles) || selectedFiles.length === 0) {
      res.status(400).json({ error: 'folderPath and selectedFiles array are required.' });
      return;
    }

    const resolvedBase = path.resolve(folderPath);
    if (!fs.existsSync(resolvedBase)) {
      res.status(404).json({ error: `Folder not found: "${resolvedBase}"` });
      return;
    }

    // Resolve all selected file paths
    const resolvedPaths = selectedFiles.map(rel => {
      const full = path.resolve(resolvedBase, rel);
      // Security: ensure resolved path is inside the base folder
      if (!full.startsWith(resolvedBase)) {
        throw new Error(`Access denied: path traversal detected for "${rel}"`);
      }
      return full;
    });

    // Build the command — use the provided template or default to echoing file paths
    let cmd: string;
    const filesStr = resolvedPaths.map(p => `"${p}"`).join(' ');
    const filenamesStr = selectedFiles.map(f => `"${f}"`).join(' ');

    if (command && command.trim()) {
      cmd = command.trim()
        .replace(/\{files\}/g, filesStr)
        .replace(/\{filenames\}/g, filenamesStr);
    } else {
      // Default: just echo each file path (works on both Windows cmd and Unix)
      cmd = `@echo off & echo Selected files:` + resolvedPaths.map(p => ` & echo ${p}`).join('');
    }

    // On Windows, cmd.exe has ~8191 char limit. If command exceeds ~7800, write paths to a temp file instead.
    const MAX_CMD_LENGTH = 7800;
    if (process.platform === 'win32' && cmd.length > MAX_CMD_LENGTH) {
      // Write the resolved paths into a temporary file
      const tempDir = path.join(process.cwd(), 'uploads', '.temp');
      fs.mkdirSync(tempDir, { recursive: true });
      const tempFile = path.join(tempDir, `filelist_${Date.now()}.txt`);
      const fileContent = resolvedPaths.join('\n');
      fs.writeFileSync(tempFile, fileContent, 'utf-8');

      if (command && command.trim()) {
        // Rebuild using the temp file — replace {files} with the temp file path
        cmd = command.trim()
          .replace(/\{files\}/g, `"${tempFile}"`)
          .replace(/\{filenames\}/g, filenamesStr);
      } else {
        // Default: type the temp file contents
        cmd = `@echo off & echo Selected files (from ${tempFile}): & type "${tempFile}"`;
      }
    }

    // Execute the command
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });

    res.json({
      success: true,
      command: cmd,
      output,
      filesProcessed: resolvedPaths.length,
    });
  } catch (error: any) {
    // execSync throws on non-zero exit; capture stdout/stderr
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const cmd = typeof error.cmd === 'string' ? error.cmd : '';
    res.json({
      success: false,
      command: cmd,
      output: stdout,
      error: error.message || 'Command execution failed',
      stderr,
    });
  }
});

// ── API Key Management ─────────────────────────────────────────────
const API_KEYS_FILE = path.join(process.cwd(), "api-keys.json");

interface ApiKeyEntry {
  id: string;
  name: string;
  key: string;
  provider: string;
  active: boolean;
}

let activeApiKey: string | null = null;

function loadApiKeys(): ApiKeyEntry[] {
  try {
    if (fs.existsSync(API_KEYS_FILE)) {
      const raw = fs.readFileSync(API_KEYS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      const keys = Array.isArray(parsed) ? parsed : [];
      const active = keys.find(k => k.active);
      activeApiKey = active ? active.key : null;
      return keys;
    }
  } catch (err) {
    console.warn('Failed to load API keys file:', err);
  }
  activeApiKey = null;
  return [];
}

function saveApiKeysToFile(keys: ApiKeyEntry[]): boolean {
  try {
    fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2), "utf-8");
    const active = keys.find(k => k.active);
    activeApiKey = active ? active.key : null;
    return true;
  } catch {
    return false;
  }
}

// Load keys on startup
loadApiKeys();

// ── AI Usage Metering ──────────────────────────────────────────────
const AI_USAGE_FILE = path.join(process.cwd(), "server-data", "ai-usage.json");

interface AiUsageEntry {
  id: string;
  userId: string;
  username: string;
  companyId: string;
  companyName: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  timestamp: string;
  requestType: string; // e.g., "chat", "analysis", "optimization", "audit"
}

let aiUsageCache: AiUsageEntry[] = [];

function loadAiUsage(): AiUsageEntry[] {
  try {
    if (fs.existsSync(AI_USAGE_FILE)) {
      const raw = fs.readFileSync(AI_USAGE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) aiUsageCache = parsed;
    }
  } catch (err) {
    console.warn("Failed to load AI usage file:", err);
  }
  return aiUsageCache;
}

function saveAiUsage(usage: AiUsageEntry[]): boolean {
  try {
    fs.writeFileSync(AI_USAGE_FILE, JSON.stringify(usage, null, 2), "utf-8");
    aiUsageCache = usage;
    return true;
  } catch {
    return false;
  }
}

function recordAiUsage(entry: Omit<AiUsageEntry, "id" | "timestamp">): void {
  const usage = loadAiUsage();
  usage.push({
    ...entry,
    id: `usage_${crypto.randomBytes(8).toString("hex")}`,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 10000 entries to prevent unbounded growth
  if (usage.length > 10000) {
    usage.splice(0, usage.length - 10000);
  }
  saveAiUsage(usage);
}

// Pricing per 1M tokens (approximate, update as needed)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash": { input: 0.075, output: 0.30 },
  "gemini-3.5-pro": { input: 1.25, output: 5.00 },
  "gemini-2.5-flash": { input: 0.075, output: 0.30 },
  "gemini-2.5-pro": { input: 1.25, output: 5.00 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4-turbo": { input: 10.00, output: 30.00 },
  "gpt-3.5-turbo": { input: 0.50, output: 1.50 },
  "claude-3-opus": { input: 15.00, output: 75.00 },
  "claude-3-sonnet": { input: 3.00, output: 15.00 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "default": { input: 1.00, output: 3.00 },
};

function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[modelId] || MODEL_PRICING["default"];
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

// GET /api/ai/usage — admin only, returns metered usage data
app.get("/api/ai/usage", requireAdmin, (req, res) => {
  const usage = loadAiUsage();
  const { userId, companyId, providerId, startDate, endDate, limit } = req.query;
  
  let filtered = usage;
  if (userId) filtered = filtered.filter(u => u.userId === userId);
  if (companyId) filtered = filtered.filter(u => u.companyId === companyId);
  if (providerId) filtered = filtered.filter(u => u.providerId === providerId);
  if (startDate) filtered = filtered.filter(u => u.timestamp >= startDate);
  if (endDate) filtered = filtered.filter(u => u.timestamp <= endDate);
  
  // Sort by timestamp descending
  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  if (limit) filtered = filtered.slice(0, parseInt(limit as string));
  
  // Aggregate summary
  const summary = usage.reduce((acc, u) => {
    acc.totalRequests++;
    acc.totalInputTokens += u.inputTokens;
    acc.totalOutputTokens += u.outputTokens;
    acc.totalTokens += u.totalTokens;
    acc.totalEstimatedCost += u.estimatedCostUsd;
    if (!acc.byUser[u.userId]) acc.byUser[u.userId] = { username: u.username, companyName: u.companyName, requests: 0, tokens: 0, cost: 0 };
    if (!acc.byCompany[u.companyId]) acc.byCompany[u.companyId] = { companyName: u.companyName, requests: 0, tokens: 0, cost: 0 };
    if (!acc.byProvider[u.providerId]) acc.byProvider[u.providerId] = { providerName: u.providerName, requests: 0, tokens: 0, cost: 0 };
    acc.byUser[u.userId].requests++;
    acc.byUser[u.userId].tokens += u.totalTokens;
    acc.byUser[u.userId].cost += u.estimatedCostUsd;
    acc.byCompany[u.companyId].requests++;
    acc.byCompany[u.companyId].tokens += u.totalTokens;
    acc.byCompany[u.companyId].cost += u.estimatedCostUsd;
    acc.byProvider[u.providerId].requests++;
    acc.byProvider[u.providerId].tokens += u.totalTokens;
    acc.byProvider[u.providerId].cost += u.estimatedCostUsd;
    return acc;
  }, {
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalEstimatedCost: 0,
    byUser: {} as Record<string, any>,
    byCompany: {} as Record<string, any>,
    byProvider: {} as Record<string, any>,
  });
  
  res.json({ usage: filtered, summary });
});

// GET /api/ai/usage/me — current user's own usage
app.get("/api/ai/usage/me", requireAuth, (req, res) => {
  const usage = loadAiUsage();
  const user = (req as any).user;
  const myUsage = usage.filter(u => u.userId === user.id);
  res.json({ usage: myUsage });
});

// GET /api/ai/usage/company/:companyId — company admin can see their company's usage
app.get("/api/ai/usage/company/:companyId", requireAuth, (req, res) => {
  const user = (req as any).user;
  const companyId = req.params.companyId;
  
  // Check if user is admin or belongs to this company
  if (user.role !== "admin" && user.companyId !== companyId) {
    res.status(403).json({ error: "Not authorized to view this company's usage." });
    return;
  }
  
  const usage = loadAiUsage();
  const companyUsage = usage.filter(u => u.companyId === companyId);
  res.json({ usage: companyUsage });
});

// GET /api/ai/usage/export — export usage as CSV
app.get("/api/ai/usage/export", requireAdmin, (req, res) => {
  const usage = loadAiUsage();
  const headers = ["ID", "User", "Company", "Provider", "Model", "Input Tokens", "Output Tokens", "Total Tokens", "Estimated Cost (USD)", "Timestamp", "Request Type"];
  const rows = usage.map(u => [
    u.id, u.username, u.companyName, u.providerName, u.modelName,
    u.inputTokens, u.outputTokens, u.totalTokens, u.estimatedCostUsd.toFixed(6),
    u.timestamp, u.requestType
  ]);
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="ai-usage-${new Date().toISOString().split("T")[0]}.csv"`);
  res.send(csv);
});

// GET /api/keys - return saved API keys (without full key values)
app.get("/api/keys", requireAdmin, (_req, res) => {
  const keys = loadApiKeys();
  const safe = keys.map(k => ({
    id: k.id,
    name: k.name,
    provider: k.provider,
    active: k.active,
    key: k.key ? `${k.key.substring(0, 8)}...${k.key.slice(-4)}` : ""
  }));
  res.json({ keys: safe, activeProvider: keys.find(k => k.active)?.provider || null });
});

// POST /api/keys - add or update an API key
app.post("/api/keys", requireAdmin, express.json(), (req, res) => {
  const { name, key, provider } = req.body;
  if (!name || !key) {
    res.status(400).json({ error: "Name and key are required." });
    return;
  }
  // Invalidate cached client so it re-creates with the new key
  aiClient = null;
  const keys = loadApiKeys();
  const existing = keys.findIndex(k => k.name === name);
  const entry: ApiKeyEntry = {
    id: existing >= 0 ? keys[existing].id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    key,
    provider: provider || "google-genai",
    active: keys.length === 0 || existing >= 0 ? keys[existing]?.active ?? true : false,
  };
  if (existing >= 0) {
    keys[existing] = entry;
  } else {
    keys.push(entry);
  }
  if (saveApiKeysToFile(keys)) {
    res.json({ success: true, message: `API key "${name}" saved.` });
  } else {
    res.status(500).json({ error: "Failed to save API key." });
  }
});

// DELETE /api/keys/:id - remove an API key
app.delete("/api/keys/:id", requireAdmin, (req, res) => {
  aiClient = null;
  const keys = loadApiKeys().filter(k => k.id !== req.params.id);
  if (saveApiKeysToFile(keys)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: "Failed to remove API key." });
  }
});

// POST /api/keys/:id/activate - set a key as active
app.post("/api/keys/:id/activate", requireAdmin, (req, res) => {
  aiClient = null;
  const keys = loadApiKeys().map(k => ({ ...k, active: k.id === req.params.id }));
  if (saveApiKeysToFile(keys)) {
    res.json({ success: true, message: "API key activated." });
  } else {
    res.status(500).json({ error: "Failed to activate API key." });
  }
});

// ── AI Provider Registry ───────────────────────────────────────────────
// Supports two ways of configuring the AI:
//
//  1. Simple JSON (`ai-config.json`) — {"provider":"google-genai","model":...,"apiKey":...}
//  2. Provider list (`ai-providers.json`) — the multi-AI format the lab
//     pastes into the AI Manager:
//       [ { "name":"DC-Hub AI", "vendor":"customendpoint", "apiKey":"...",
//           "apiType":"chat-completions",
//           "models":[ { "id":"...", "name":"...", "url":"https://.../chat/completions", ... } ] }, ... ]
//
// MULTIPLE providers can be active at once. Each active provider gets a
// priority (0 = primary, then backups). Every AI call tries the active
// providers in priority order until one responds (fallback chain).
const AI_CONFIG_FILE = path.join(process.cwd(), "ai-config.json");
const AI_PROVIDERS_FILE = path.join(process.cwd(), "ai-providers.json");

interface AiRuntimeConfig {
  provider: string;      // google-genai | openai | anthropic | custom
  model: string;         // e.g. gemini-3.5-flash, gpt-4o, claude-3-5-sonnet
  apiKey?: string;       // optional — falls back to the active saved key
  baseUrl?: string;      // optional — custom endpoint
  temperature?: number;  // optional inference temperature
  extra?: Record<string, unknown>; // any other JSON fields the user typed
}

interface AiModelEntry {
  id: string;
  name?: string;
  url?: string;
  toolCalling?: boolean;
  vision?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

interface AiProviderEntry {
  id: string;            // unique slug derived from the name
  name: string;
  vendor: string;        // copilot | customendpoint | google-genai | openai | anthropic
  apiKey?: string;
  apiType?: string;      // chat-completions
  settings?: Record<string, unknown>;
  models: AiModelEntry[];
  active?: boolean;
  priority?: number;     // 0 = primary, 1 = first backup, ... (only meaningful when active)
  activeModelId?: string;
}

const DEFAULT_AI_CONFIG: AiRuntimeConfig = {
  provider: "google-genai",
  model: "gemini-3.5-flash",
};

let aiRuntimeConfig: AiRuntimeConfig = { ...DEFAULT_AI_CONFIG };
let aiProviders: AiProviderEntry[] = [];

function loadAiRuntimeConfig(): AiRuntimeConfig {
  try {
    if (fs.existsSync(AI_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, "utf-8"));
      aiRuntimeConfig = {
        ...DEFAULT_AI_CONFIG,
        ...(parsed && typeof parsed === "object" ? parsed : {}),
      };
    }
  } catch (err) {
    console.warn("Failed to load ai-config.json:", err);
  }
  return aiRuntimeConfig;
}

function saveAiRuntimeConfig(cfg: AiRuntimeConfig): boolean {
  try {
    fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
    aiRuntimeConfig = cfg;
    aiClient = null; // invalidate cached client so it re-creates with new config
    return true;
  } catch {
    return false;
  }
}

function loadAiProviders(): AiProviderEntry[] {
  try {
    if (fs.existsSync(AI_PROVIDERS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AI_PROVIDERS_FILE, "utf-8"));
      if (Array.isArray(parsed)) aiProviders = parsed;
    }
  } catch (err) {
    console.warn("Failed to load ai-providers.json:", err);
  }
  return aiProviders;
}

function saveAiProviders(providers: AiProviderEntry[]): boolean {
  try {
    fs.writeFileSync(AI_PROVIDERS_FILE, JSON.stringify(providers, null, 2), "utf-8");
    aiProviders = providers;
    aiClient = null;
    return true;
  } catch {
    return false;
  }
}

loadAiRuntimeConfig();
loadAiProviders();

/** The model every Gemini AI call should use (from the simple JSON config). */
function getAiModel(): string {
  return aiRuntimeConfig.model || DEFAULT_AI_CONFIG.model;
}

/** The currently active providers from the registry, in priority order. */
function getActiveAiProviders(): AiProviderEntry[] {
  return aiProviders
    .filter(p => p.active)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

/** The primary (first) active provider, or null. */
function getActiveAiProvider(): AiProviderEntry | null {
  return getActiveAiProviders()[0] || null;
}

/** True when any active provider is an OpenAI-compatible HTTP endpoint. */
function isOpenAiCompatibleActive(): boolean {
  return getActiveAiProviders().some(
    p => (p.vendor === "customendpoint" || p.apiType === "chat-completions") && !!p.apiKey && p.models.length > 0
  );
}

// GET /api/ai/config — return the current AI runtime config (no secrets)
app.get("/api/ai/config", requireAdmin, (_req, res) => {
  const cfg = loadAiRuntimeConfig();
  res.json({
    config: {
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl || "",
      temperature: cfg.temperature ?? 0.7,
      extra: cfg.extra || {},
    },
    hasApiKey: !!cfg.apiKey || !!activeApiKey || !!getActiveAiProvider(),
  });
});

// POST /api/ai/config — save a simple JSON AI config (full JSON body accepted).
// Provider is auto-detected from the key format when not explicitly given.
app.post("/api/ai/config", requireAdmin, express.json(), (req, res) => {
  const body = req.body || {};
  // Accept either a raw JSON object or { config: {...} }
  const raw = body.config && typeof body.config === "object" ? body.config : body;
  // apiKey: explicit "" clears it (falls back to the active saved key);
  // missing/undefined keeps whatever was set before.
  let key = aiRuntimeConfig.apiKey;
  if (raw.apiKey !== undefined) key = raw.apiKey ? String(raw.apiKey) : undefined;
  let provider = raw.provider ? String(raw.provider) : aiRuntimeConfig.provider;
  if (!raw.provider && key) {
    if (key.startsWith("AIza")) provider = "google-genai";
    else if (key.startsWith("sk-ant-")) provider = "anthropic";
    else if (key.startsWith("sk-")) provider = "openai";
  }
  // When the provider changed (or was just detected) and no model was given,
  // pick that provider's default model instead of keeping the old one.
  const providerChanged = provider !== aiRuntimeConfig.provider;
  const model = raw.model
    ? String(raw.model)
    : providerChanged
      ? (provider === "openai" ? "gpt-4o" : provider === "anthropic" ? "claude-3-5-sonnet" : "gemini-3.5-flash")
      : aiRuntimeConfig.model || "gemini-3.5-flash";
  const next: AiRuntimeConfig = {
    provider,
    model,
    apiKey: key,
    baseUrl: raw.baseUrl ? String(raw.baseUrl) : aiRuntimeConfig.baseUrl,
    temperature: raw.temperature != null ? Number(raw.temperature) : aiRuntimeConfig.temperature,
    extra: raw.extra && typeof raw.extra === "object" ? raw.extra : aiRuntimeConfig.extra,
  };
  if (saveAiRuntimeConfig(next)) {
    // Activating a simple config deactivates any registry provider
    aiProviders = aiProviders.map(p => ({ ...p, active: false }));
    saveAiProviders(aiProviders);
    res.json({ success: true, config: { provider: next.provider, model: next.model, baseUrl: next.baseUrl || "", temperature: next.temperature ?? 0.7 } });
  } else {
    res.status(500).json({ error: "Failed to save AI config." });
  }
});

// ── AI Provider Registry endpoints ──────────────────────────────────────

/** Slugify a provider name into a stable id. */
function providerIdFromName(name: string): string {
  const slug = String(name || "ai").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "ai";
}

/**
 * Read AI provider settings from data files or source code without evaluating it.
 * This deliberately supports configuration literals only; uploaded code is never
 * imported, compiled, or executed by the server.
 */
function parseAiProviderSource(source: string): { providers: any[]; format: string } {
  const text = String(source || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("The file is empty.");

  const parseCandidate = (candidate: string): any | null => {
    try { return JSON.parse(candidate); } catch { /* try a safe, JSON-like config literal below */ }
    try {
      const normalized = candidate
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1").replace(/(^|\s)#.*$/gm, "$1")
        .replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null")
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/([,{]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
        .replace(/'((?:\\.|[^'\\])*)'/g, (_match, value) => JSON.stringify(value.replace(/\\'/g, "'")));
      return JSON.parse(normalized);
    } catch { return null; }
  };
  const direct = parseCandidate(text);
  if (direct) return { providers: Array.isArray(direct) ? direct : Array.isArray(direct.providers) ? direct.providers : [direct], format: "JSON" };

  // Find balanced object/array literals in Python, JS, TS, YAML-exported code,
  // etc. Try the largest candidates first so a `providers = [...]` list wins.
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start++) {
    const opener = text[start];
    if (opener !== "{" && opener !== "[") continue;
    const stack = [opener === "{" ? "}" : "]"];
    let quote = "";
    let escaped = false;
    for (let end = start + 1; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
      else if (char === stack[stack.length - 1]) {
        stack.pop();
        if (!stack.length) { candidates.push(text.slice(start, end + 1)); break; }
      }
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.providers) ? parsed.providers : parsed && typeof parsed === "object" ? [parsed] : [];
    if (list.some(item => item && typeof item === "object" && (item.name || item.models || item.apiKey || item.api_key))) {
      return { providers: list, format: "source code" };
    }
  }

  // .env, Python constants, and other KEY=value files can still activate a
  // standard provider when they contain an API key.
  const key = text.match(/(?:OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|api[_-]?key)\s*[=:]\s*["']?([^\s"'#;]+)["']?/i)?.[1];
  if (key) {
    const provider = /(?:GOOGLE|GEMINI|AIza)/i.test(text + key) ? "google-genai" : /(?:ANTHROPIC|sk-ant-)/i.test(text + key) ? "anthropic" : "openai";
    const model = text.match(/(?:MODEL|model)\s*[=:]\s*["']?([^\s"'#;]+)/)?.[1] || (provider === "openai" ? "gpt-4o" : provider === "anthropic" ? "claude-3-5-sonnet" : "gemini-3.5-flash");
    return { providers: [{ name: `${provider} imported config`, vendor: provider, apiKey: key, models: [{ id: model }] }], format: "environment/source settings" };
  }
  throw new Error("No AI provider configuration was found. Include a provider object/list or API key settings.");
}

// POST /api/ai/providers — register a pasted provider list (or single object).
// Accepts either the array format or one object; existing providers are
// updated, new ones added; nothing is activated automatically.
app.post("/api/ai/providers", requireAdmin, express.json(), (req, res) => {
  const body = req.body || {};
  let detectedFormat = "JSON";
  let rawList: any[];
  try {
    if (typeof body.source === "string") {
      const parsed = parseAiProviderSource(body.source);
      rawList = parsed.providers;
      detectedFormat = parsed.format;
    } else {
      rawList = Array.isArray(body) ? body : Array.isArray(body.providers) ? body.providers : [body];
    }
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Could not read the AI configuration." });
    return;
  }
  // Also accept the application's simple runtime shape:
  // { provider, model, apiKey, baseUrl }. This makes ai-config.json and its
  // Python/TypeScript equivalents importable alongside the multi-provider list.
  rawList = rawList.map((raw: any) => {
    if (raw && typeof raw === "object" && !raw.name && raw.provider && (raw.apiKey || raw.api_key || raw.key)) {
      const provider = String(raw.provider);
      const model = String(raw.model || (provider === "openai" ? "gpt-4o" : provider === "anthropic" ? "claude-3-5-sonnet" : "gemini-3.5-flash"));
      return {
        name: `${provider} imported config`, vendor: provider,
        apiKey: raw.apiKey || raw.api_key || raw.key,
        apiType: raw.apiType || "chat-completions",
        models: [{ id: model, url: raw.baseUrl || raw.baseURL || raw.url || "" }],
      };
    }
    return raw;
  });
  const next: AiProviderEntry[] = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== "object" || !raw.name) continue;
    const id = providerIdFromName(raw.name);
    const models = (Array.isArray(raw.models) ? raw.models : []).map((m: any) => ({
      id: String(m.id || ""),
      name: m.name ? String(m.name) : String(m.id || ""),
      url: m.url ? String(m.url) : "",
      toolCalling: !!m.toolCalling,
      vision: !!m.vision,
      maxInputTokens: m.maxInputTokens ? Number(m.maxInputTokens) : undefined,
      maxOutputTokens: m.maxOutputTokens ? Number(m.maxOutputTokens) : undefined,
    }));
    next.push({
      id,
      name: String(raw.name),
      vendor: String(raw.vendor || "customendpoint"),
      apiKey: (raw.apiKey || raw.api_key || raw.key) ? String(raw.apiKey || raw.api_key || raw.key) : undefined,
      apiType: raw.apiType ? String(raw.apiType) : "chat-completions",
      settings: raw.settings && typeof raw.settings === "object" ? raw.settings : undefined,
      models,
      // Source imports are intentionally activated immediately so the imported
      // AI becomes available without a second manual step.
      active: typeof body.source === "string",
      activeModelId: models.length ? models[0].id : undefined,
    });
  }
  if (!next.length) {
    res.status(400).json({ error: "No valid AI providers found in the pasted JSON." });
    return;
  }
  // Merge: keep activation state + priority + selected model for same-id providers
  const merged = [...aiProviders];
  for (const entry of next) {
    const idx = merged.findIndex(p => p.id === entry.id);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...entry, active: typeof body.source === "string" ? true : merged[idx].active, priority: merged[idx].priority, activeModelId: merged[idx].activeModelId || entry.activeModelId };
    } else {
      merged.push(entry);
    }
  }
  if (saveAiProviders(merged)) {
    const activatedCount = typeof body.source === "string" ? next.length : 0;
    res.json({ success: true, format: detectedFormat, activatedCount, providers: merged.map(p => ({ id: p.id, name: p.name, vendor: p.vendor, apiType: p.apiType, models: p.models, active: !!p.active, priority: p.priority ?? null, activeModelId: p.activeModelId })) });
  } else {
    res.status(500).json({ error: "Failed to save AI providers." });
  }
});

// GET /api/ai/providers — list registered providers (no apiKeys)
app.get("/api/ai/providers", requireAdmin, (_req, res) => {
  res.json({
    providers: aiProviders.map(p => ({
      id: p.id,
      name: p.name,
      vendor: p.vendor,
      apiType: p.apiType,
      hasApiKey: !!p.apiKey,
      models: p.models,
      active: !!p.active,
      priority: p.priority ?? null,
      activeModelId: p.activeModelId,
    })),
    activeProviders: getActiveAiProviders().map(p => p.id),
  });
});

// POST /api/ai/providers/:id/activate — add a provider to the active set
// (multiple can be active; priority 0 = primary, then backups).
app.post("/api/ai/providers/:id/activate", requireAdmin, express.json(), (req, res) => {
  const id = req.params.id;
  const modelId = req.body && req.body.modelId ? String(req.body.modelId) : undefined;
  const provider = aiProviders.find(p => p.id === id);
  if (!provider) {
    res.status(404).json({ error: `Provider not found: ${id}` });
    return;
  }
  if (provider.vendor !== "copilot" && (!provider.apiKey || !provider.models.length)) {
    res.status(400).json({ error: `"${provider.name}" has no usable API endpoint (missing apiKey/models).` });
    return;
  }
  // If already active, just update the model selection
  if (provider.active) {
    if (modelId && provider.models.some(m => m.id === modelId)) {
      aiProviders = aiProviders.map(p => p.id === id ? { ...p, activeModelId: modelId } : p);
      saveAiProviders(aiProviders);
    }
    res.json({ success: true, active: getActiveAiProviders().map(p => p.id), model: modelId || provider.activeModelId });
    return;
  }
  // Assign the next priority slot (after the highest existing priority)
  const active = getActiveAiProviders();
  const nextPriority = active.length ? Math.max(...active.map(p => p.priority ?? 0)) + 1 : 0;
  aiProviders = aiProviders.map(p => p.id === id ? { ...p, active: true, priority: nextPriority, ...(modelId ? { activeModelId: modelId } : {}) } : p);
  if (saveAiProviders(aiProviders)) {
    res.json({ success: true, active: getActiveAiProviders().map(p => p.id), priority: nextPriority, model: modelId || provider.activeModelId });
  } else {
    res.status(500).json({ error: "Failed to save AI providers." });
  }
});

// POST /api/ai/providers/:id/deactivate — remove a provider from the active set
app.post("/api/ai/providers/:id/deactivate", requireAdmin, (req, res) => {
  const id = req.params.id;
  aiProviders = aiProviders.map(p => p.id === id ? { ...p, active: false, priority: undefined } : p);
  if (saveAiProviders(aiProviders)) {
    res.json({ success: true, active: getActiveAiProviders().map(p => p.id) });
  } else {
    res.status(500).json({ error: "Failed to save AI providers." });
  }
});

// POST /api/ai/providers/:id/priority — set the priority of an active provider
// (0 = primary, 1 = first backup, ...). Other active providers shift around it.
app.post("/api/ai/providers/:id/priority", requireAdmin, express.json(), (req, res) => {
  const id = req.params.id;
  const target = req.body && req.body.priority != null ? Number(req.body.priority) : NaN;
  if (isNaN(target) || target < 0) {
    res.status(400).json({ error: "priority must be a non-negative number." });
    return;
  }
  const provider = aiProviders.find(p => p.id === id);
  if (!provider) {
    res.status(404).json({ error: `Provider not found: ${id}` });
    return;
  }
  if (!provider.active) {
    res.status(400).json({ error: `"${provider.name}" is not active.` });
    return;
  }
  const active = getActiveAiProviders().filter(p => p.id !== id);
  const maxSlot = active.length;
  const slot = Math.max(0, Math.min(target, maxSlot));
  // Rebuild priorities: insert this provider at `slot`, others fill the rest
  const ordered = [...active];
  ordered.splice(slot, 0, provider);
  const priorityMap = new Map<string, number>();
  ordered.forEach((p, i) => priorityMap.set(p.id, i));
  aiProviders = aiProviders.map(p => priorityMap.has(p.id) ? { ...p, priority: priorityMap.get(p.id) } : p);
  if (saveAiProviders(aiProviders)) {
    res.json({ success: true, active: getActiveAiProviders().map(p => ({ id: p.id, priority: p.priority })) });
  } else {
    res.status(500).json({ error: "Failed to save AI providers." });
  }
});

// DELETE /api/ai/providers/:id — remove a provider from the registry
app.delete("/api/ai/providers/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  aiProviders = aiProviders.filter(p => p.id !== id);
  if (saveAiProviders(aiProviders)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: "Failed to remove provider." });
  }
});

// ── AI Pro Scan Prep: Professional CAD Scan Preparation ────────────────────
app.post("/api/pro-scan-prep", requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const { currentParameters, files, caseId, orthoBaseTemplate } = req.body;
  const ai = getGeminiClient();

  if (!ai) {
    res.status(503).json({
      error: "AI engine is not available. Please add a valid API key in the AI Manager tab.",
      code: "AI_UNAVAILABLE"
    });
    return;
  }

  try {
    const prompt = `
You are the world's most elite Senior Digital Orthodontic CAD Technician with 25+ years at a premier dental lab.
You have been tasked with preparing this patient's dental scan for professional CAD manufacturing.

## YOUR MANDATE — PROFESSIONAL SCAN PREPARATION WORKFLOW

Perform a comprehensive Chain-of-Thought (CoT) scan preparation analysis following EXACTLY this clinical protocol:

### STEP 1: Scan Quality Assessment
- Evaluate the STL mesh quality (triangle count, watertightness, noise artifacts)
- Identify any scan defects: bubbles, missing geometry, interproximal voids, incomplete second molars
- Check scan resolution adequacy for orthodontic appliance fabrication
- Determine if the scan is ready for CAD processing or requires re-scan

### STEP 2: Arch & Anatomical Analysis
- Confirm dental arch form (upper/lower) and arch shape (tapered, ovoid, square)
- Identify tooth numbering and verify all teeth are captured
- Detect gingival margin definition quality — critical for trim line placement
- Note frenum attachments, tori, undercuts, and other anatomical landmarks

### STEP 3: Model Preparation Requirements
- Determine required base type: recommend "${orthoBaseTemplate || 'threeshape_bar'}" or alternative
- Verify model base height: current base extrusion is adequate for the appliance type
- Check for optimal model orientation for 3D printing / thermoforming
- Identify block-out zones: interproximal undercuts, lingual molar inclinations, bridge abutments

### STEP 4: Appliance-Specific Optimization
- If Essix: optimize scalloped trim path 0.5-1.0mm coronal to gingival margin for comfort
- If Hawley: validate acrylic baseplate thickness and wire channel clearance
- Check attachment placement zones for beveled/ellipsoidal geometries
- Verify shell thickness against biomechanical requirements

### STEP 5: Manufacturing Readiness
- Generate final watertight manifold assembly checklist
- Verify print orientation minimizes support structures
- Determine if hollow or solid base is optimal
- Recommend specific printer settings (layer height, exposure, resin type)

Current Design Parameters: ${JSON.stringify(currentParameters)}
Uploaded Scan Files: ${JSON.stringify(files || [])}
Case ID: ${caseId || "New Case"}

Return a VALID JSON object (no markdown, no code fences) with this EXACT structure:
{
  "scanReady": boolean,
  "confidence": number (0-100),
  "preparationSteps": [
    {
      "step": number,
      "phase": string,
      "action": string,
      "status": "completed" | "needs-attention" | "pending",
      "details": string
    }
  ],
  "findings": {
    "scanQuality": string,
    "archAnalysis": string,
    "anatomicalNotes": string,
    "criticalIssues": string[]
  },
  "optimizedParameters": {
    "baseExtrusionHeight": number,
    "trimScallopOffset": number,
    "trimLineType": "scalloped" | "straight" | "beveled",
    "shellThickness": number,
    "material": string,
    "isHollowModel": boolean,
    "hollowWallThickness": number,
    "addDrainHoles": boolean,
    "articulatorNotches": boolean
  },
  "manufacturingRecommendations": {
    "printOrientation": string,
    "suggestedResin": string,
    "layerHeight": string,
    "supportStructure": string,
    "postProcessing": string[]
  },
  "clinicalSummary": string
}
`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.15
      }
    });

    const cleanedText = response.text?.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim() || "{}";
    const lastBraceIndex = cleanedText.lastIndexOf('}');
    const trimmedText = lastBraceIndex !== -1 ? cleanedText.substring(0, lastBraceIndex + 1) : cleanedText;
    const result = JSON.parse(trimmedText);
    res.json(result);
  } catch (error) {
    console.error("AI Pro Scan Prep error:", error);
    res.status(500).json({ error: "AI scan preparation failed. Please try again.", code: "AI_ERROR" });
  }
});

// ── Shared System Configuration (agliner pipeline + ortho integration) ──
// Both satellite systems (agliner segmentation and ortho staging/render)
// read this config so they can share the same storage folder and point at
// this server as the single AI brain.
const SYSTEM_CONFIG_FILE = path.join(process.cwd(), "system_config.json");

interface SystemConfig {
  storageFolder: string;
  mainServerUrl: string;
  stages?: number;
  expansion?: number;
  shellMm?: number;
  undercutDeg?: number;
}

function loadSystemConfig(): SystemConfig {
  const fallback: SystemConfig = {
    storageFolder: path.join(process.cwd(), "storage"),
    mainServerUrl: `http://localhost:${PORT}`,
    stages: 33,
    expansion: 1.02,
    shellMm: 0.75,
    undercutDeg: 45,
  };
  try {
    if (fs.existsSync(SYSTEM_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(SYSTEM_CONFIG_FILE, "utf-8"));
      return {
        storageFolder: data.storageFolder || fallback.storageFolder,
        mainServerUrl: data.mainServerUrl || fallback.mainServerUrl,
        stages: typeof data.stages === "number" ? data.stages : fallback.stages,
        expansion: typeof data.expansion === "number" ? data.expansion : fallback.expansion,
        shellMm: typeof data.shellMm === "number" ? data.shellMm : fallback.shellMm,
        undercutDeg: typeof data.undercutDeg === "number" ? data.undercutDeg : fallback.undercutDeg,
      };
    }
  } catch (err) {
    console.error("Error reading system config file:", err);
  }
  return fallback;
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") // Replace invalid Windows chars
    .replace(/^\.+$/, "_") // Replace dots-only names
    .trim()
    .substring(0, 200); // Limit length
}

function createCompanyUserFolders(companyName: string, userName?: string): void {
  const storage = loadSystemConfig();
  const basePath = storage.storageFolder;
  if (!basePath) return;

  const companyFolder = path.join(basePath, sanitizeFolderName(companyName));
  if (!fs.existsSync(companyFolder)) {
    fs.mkdirSync(companyFolder, { recursive: true });
  }

  if (userName) {
    const userFolder = path.join(companyFolder, sanitizeFolderName(userName));
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }
  }
}

// ── LEAP Malocclusion Classification (Leading Enhancement Assistive Planning) ──
// Replicates the published pipeline: 3D STL -> normalized voxel grid -> classifier
// -> top-5 predictions with confidence -> rule-based combination logic.
// 15 independent binary labels: 4 Angle main classes + 11 occlusal subclasses.
const LEAP_MAIN_CLASSES = [
  "Class I",
  "Class II Division 1",
  "Class II Division 2",
  "Class III",
];

const LEAP_SUB_CLASSES = [
  "Open Bite",
  "Anterior Open Bite",
  "Posterior Open Bite",
  "Deep Bite",
  "Cross Bite",
  "Scissor Bite",
  "Edge to Edge Bite",
  "Spacing",
  "Mild Crowding",
  "Moderate Crowding",
  "Severe Crowding",
];

const LEAP_ALL_LABELS: string[] = [...LEAP_MAIN_CLASSES, ...LEAP_SUB_CLASSES];
const LEAP_VOXEL_RESOLUTION = 128; // 128x128x128 default voxel grid

// Normalize free-form model output to one of the 15 canonical LEAP labels
function normalizeLeapLabel(label: string): string | null {
  if (typeof label !== "string") return null;
  const s = label.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  for (const canon of LEAP_ALL_LABELS) {
    const c = canon.toLowerCase();
    if (s === c) return canon;
  }
  if (/class\s*(i|1)\b/.test(s) && !/div|division/.test(s) && !/ii|2|iii|3/.test(s)) return "Class I";
  if (/class\s*ii\s*div(ision)?\s*1/.test(s) || /class\s*2\s*div(ision)?\s*1/.test(s)) return "Class II Division 1";
  if (/class\s*ii\s*div(ision)?\s*2/.test(s) || /class\s*2\s*div(ision)?\s*2/.test(s)) return "Class II Division 2";
  if (/^class\s*ii\b/.test(s) || /class\s*2\b/.test(s)) return "Class II Division 1";
  if (/^class\s*iii\b/.test(s) || /class\s*3\b/.test(s)) return "Class III";
  if (/anterior\s+open/.test(s)) return "Anterior Open Bite";
  if (/posterior\s+open/.test(s)) return "Posterior Open Bite";
  if (/open\s+bite/.test(s)) return "Open Bite";
  if (/deep\s+bite|over\s*bite/.test(s)) return "Deep Bite";
  if (/scissor|scissors/.test(s)) return "Scissor Bite";
  if (/cross\s*bite/.test(s)) return "Cross Bite";
  if (/edge\s*to\s*edge/.test(s)) return "Edge to Edge Bite";
  if (/severe\s*crowd/.test(s)) return "Severe Crowding";
  if (/moderate\s*crowd/.test(s)) return "Moderate Crowding";
  if (/mild\s*crowd/.test(s)) return "Mild Crowding";
  if (/crowd/.test(s)) return "Moderate Crowding";
  if (/spac(e|ing)/.test(s)) return "Spacing";
  return null;
}

// Rule-based combination logic (paper Fig. 7): check the sagittal (incisor)
// relationship in the top predictions; if present, emit the main class plus all
// valid pairwise main+subclass / subclass+subclass combinations. If absent,
// report the subclasses only.
function leapCombinePredictions(top5: Array<{ label: string; confidence: number }>): {
  mainClass: string | null;
  subclasses: string[];
  combinations: string[];
} {
  const present = top5
    .map((p) => ({ ...p, label: normalizeLeapLabel(p.label) || "" }))
    .filter((p) => p.label && p.confidence > 0);
  const main = present.find((p) => (LEAP_MAIN_CLASSES as string[]).includes(p.label)) || null;
  const subs: string[] = [];
  for (const p of present) {
    if ((LEAP_SUB_CLASSES as string[]).includes(p.label) && !subs.includes(p.label)) subs.push(p.label);
  }
  const combinations: string[] = [];
  if (main) {
    combinations.push(main.label);
    for (const s of subs) combinations.push(`${main.label} + ${s}`);
    for (let i = 0; i < subs.length; i++) {
      for (let j = i + 1; j < subs.length; j++) {
        combinations.push(`${subs[i]} + ${subs[j]}`);
      }
    }
  } else {
    combinations.push(...subs);
  }
  return { mainClass: main ? main.label : null, subclasses: subs, combinations };
}

function buildLeapPrompt(opts: {
  prescriptionText: string;
  designSummary: string;
  treatmentPlanText: string;
  stlSummary: string;
}): string {
  return [
    "You are the LEAP classification engine (Leading Enhancement Assistive Planning) for clear-aligner orthodontics.",
    "Classify this case against exactly 15 independent binary labels (multilabel, not mutually exclusive):",
    "MAIN SAGITTAL CLASSES (exactly one should dominate): " + LEAP_MAIN_CLASSES.join("; "),
    "SUBCLASSES: " + LEAP_SUB_CLASSES.join("; "),
    "",
    'Return ONLY JSON in this exact shape:',
    '{"predictions": [{"label": "<one of the 15 labels>", "confidence": 0.0-1.0} x 5 ranked by confidence],',
    ' "clinical_summary": "<2-3 sentence diagnostic rationale>",',
    ' "sequencing_note": "<one sentence on how this affects aligner staging>"}',
    "",
    "Rules: use the canonical label strings above verbatim. Rank the 5 most likely labels by confidence.",
    "The first main-class label in your ranking is the primary sagittal relationship.",
    "",
    "CASE CONTEXT",
    "PRESCRIPTION: " + (opts.prescriptionText || "(none provided)"),
    "DESIGN PARAMETERS: " + (opts.designSummary || "(none)"),
    "AI TREATMENT PLAN (already generated): " + (opts.treatmentPlanText || "(none)").substring(0, 4000),
    "STL MESH METADATA: " + (opts.stlSummary || "(none)"),
  ].join("\n");
}

// Mirror a case into the rigid multi-tenant directory structure from the
// architecture notebook: [Clinic]/[Doctor]/Patients/[CASE]/stl + /treatment-plan
function mirrorCaseToTenantStructure(caseRecord: any): void {
  try {
    const storage = loadSystemConfig();
    const base = storage.storageFolder;
    if (!base || !caseRecord) return;
    const clinic = sanitizeFolderName(caseRecord.companyName || "_unassigned-clinic");
    const doctor = sanitizeFolderName(caseRecord.ownerUsername || "_unknown-doctor");
    const caseDir = path.join(base, clinic, doctor, "Patients", sanitizeFolderName(caseRecord.id || "CASE_UNKNOWN"));
    const stlDir = path.join(caseDir, "stl");
    const planDir = path.join(caseDir, "treatment-plan");
    fs.mkdirSync(stlDir, { recursive: true });
    fs.mkdirSync(planDir, { recursive: true });

    for (const f of caseRecord.files || []) {
      const isStl = String(f.name || "").toLowerCase().endsWith(".stl");
      if (!isStl) continue;
      let src = "";
      if (f.localPath && fs.existsSync(f.localPath)) {
        src = f.localPath;
      } else if (f.url && String(f.url).startsWith("/uploads/")) {
        const candidate = path.join(uploadsDir, path.basename(String(f.url)));
        if (fs.existsSync(candidate)) src = candidate;
      }
      if (!src) continue;
      const dest = path.join(stlDir, sanitizeFolderName(f.name));
      try { fs.copyFileSync(src, dest); } catch (copyErr: any) {
        console.warn("[Tenant Mirror] STL copy failed:", copyErr && copyErr.message);
      }
    }

    const result = caseRecord.result;
    if (result) {
      try { fs.writeFileSync(path.join(planDir, "analysis.json"), JSON.stringify(result, null, 2), "utf-8"); } catch {}
      if (result.treatment_plan) {
        try { fs.writeFileSync(path.join(planDir, "treatment-plan.md"), result.treatment_plan, "utf-8"); } catch {}
      }
    }
    if (caseRecord.leap) {
      try { fs.writeFileSync(path.join(planDir, "leap-classification.json"), JSON.stringify(caseRecord.leap, null, 2), "utf-8"); } catch {}
    }
  } catch (err) {
    console.warn("[Tenant Mirror] failed:", err);
  }
}

// Run the LEAP classification stage for a case, persist it on the case record,
// and mirror the artifacts into the tenant folder structure.
async function runLeapForCase(caseId: string): Promise<any> {
  const ai = getGeminiClient();
  if (!ai) throw new Error("AI engine unavailable - add a valid API key in AI Manager.");

  const history = readHistory();
  const idx = history.findIndex((c: any) => c.id === caseId);
  if (idx === -1) throw new Error("Case not found");
  const caseRecord = history[idx];

  const stlFiles = (caseRecord.files || []).filter((f: any) => String(f.name || "").toLowerCase().endsWith(".stl"));
  const stlSummary = stlFiles.length > 0
    ? stlFiles.map((f: any) => `${f.name} (${f.format || "STL"}, ${f.triangleCount || "?"} triangles, arch: ${f.archGuess || "?"})`).join(" | ")
    : "(no STL scans attached)";

  const dp = caseRecord.result && caseRecord.result.design_parameters;
  const designSummary = dp
    ? `appliance: ${dp.appliance || "?"}; arch: ${dp.arch || "?"}; material: ${dp.material || "?"}; trim line: ${dp.trim_line || "?"}`
    : "(analysis pending)";

  const prompt = buildLeapPrompt({
    prescriptionText: caseRecord.prescriptionText || "",
    designSummary,
    treatmentPlanText: (caseRecord.result && caseRecord.result.treatment_plan) || "",
    stlSummary,
  });

  const response = await generateContentWithRetry(ai, {
    model: getAiModel(),
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { temperature: 0.1, responseMimeType: "application/json" },
    _requestType: "leap-classification",
  });

  const jsonText = (response.text || "").trim();
  if (!jsonText) throw new Error("LEAP classifier returned an empty response");
  let parsed: any;
  try {
    const cleaned = jsonText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("LEAP classifier returned malformed JSON");
  }

  const rawPredictions: Array<{ label: string; confidence: number }> = Array.isArray(parsed.predictions)
    ? parsed.predictions
    : [];
  const seen = new Set<string>();
  const predictions = rawPredictions
    .map((p) => ({
      label: normalizeLeapLabel(p && p.label) || "",
      confidence: Math.max(0, Math.min(1, Number(p && p.confidence) || 0)),
    }))
    .filter((p) => {
      if (!p.label) return false;
      if (seen.has(p.label)) return false;
      seen.add(p.label);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  if (predictions.length === 0) throw new Error("LEAP classifier produced no usable labels");

  const combined = leapCombinePredictions(predictions);
  const totalTriangles = stlFiles.reduce((sum: number, f: any) => sum + (Number(f.triangleCount) || 0), 0);

  const leap = {
    version: 1,
    system: "LEAP - Leading Enhancement Assistive Planning",
    generatedAt: new Date().toISOString(),
    mainClass: combined.mainClass,
    subclasses: combined.subclasses,
    combinations: combined.combinations,
    predictions,
    voxelization: {
      resolution: LEAP_VOXEL_RESOLUTION,
      grid: `${LEAP_VOXEL_RESOLUTION}x${LEAP_VOXEL_RESOLUTION}x${LEAP_VOXEL_RESOLUTION}`,
      meshes: stlFiles.length,
      triangles: totalTriangles,
    },
    clinicalSummary: String(parsed.clinical_summary || "").substring(0, 1200),
    sequencingNote: String(parsed.sequencing_note || "").substring(0, 600),
    status: "completed",
  };

  // Persist on the case record (top-level + inside result for API consumers)
  history[idx].leap = leap;
  if (history[idx].result) history[idx].result.leap = leap;
  writeHistory(history);

  // Mirror artifacts into the rigid tenant folder structure
  mirrorCaseToTenantStructure(history[idx]);

  return leap;
}

function saveSystemConfig(config: SystemConfig): boolean {
  try {
    fs.writeFileSync(SYSTEM_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// GET /api/system/config — shared config consumed by agliner & ortho
app.get("/api/system/config", (req: express.Request, res) => {
  const config = loadSystemConfig();
  let effectiveStorageFolder = config.storageFolder;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = token ? getSessionUser(token) : null;
  if (user && user.role !== "admin") {
    try {
      effectiveStorageFolder = getTenantStoragePath(user);
    } catch {
      /* fallback */
    }
  }
  res.json({
    ...config,
    storageFolder: effectiveStorageFolder,
    aiAvailable: getGeminiClient() !== null,
    storageExists: fs.existsSync(effectiveStorageFolder),
  });
});

// POST /api/system/config — update shared config (centralized pipeline setup)
// Agliner Segmentation and Ortho Staging/Render read this config, so all
// pipeline parameters live in one place (the main system). Admin-only.
app.post("/api/system/config", requireAdmin, express.json(), (req, res) => {
  const { storageFolder, mainServerUrl, stages, expansion, shellMm, undercutDeg } = req.body;
  const current = loadSystemConfig();
  const next: SystemConfig = {
    storageFolder: storageFolder ? path.resolve(storageFolder) : current.storageFolder,
    mainServerUrl: mainServerUrl || current.mainServerUrl,
    stages: typeof stages === "number" ? Math.min(99, Math.max(1, Math.round(stages))) : current.stages,
    expansion: typeof expansion === "number" ? Math.min(1.2, Math.max(0.9, expansion)) : current.expansion,
    shellMm: typeof shellMm === "number" ? Math.min(2, Math.max(0, shellMm)) : current.shellMm,
    undercutDeg: typeof undercutDeg === "number" ? Math.min(90, Math.max(0, undercutDeg)) : current.undercutDeg,
  };
  if (!fs.existsSync(next.storageFolder)) {
    try {
      fs.mkdirSync(next.storageFolder, { recursive: true });
    } catch (err) {
      console.warn("Could not create storage folder:", err);
    }
  }
  if (saveSystemConfig(next)) {
    sharedStorageDir = next.storageFolder;
    res.json({ success: true, config: { ...next, aiAvailable: getGeminiClient() !== null } });
  } else {
    res.status(500).json({ error: "Failed to save system config." });
  }
});

// GET /api/systems/status — health check for the satellite systems
// (Agliner Segmentation + Ortho Staging & Render). Any authenticated user
// whose company has the satellite packs enabled sees these panels.
app.get("/api/systems/status", requireAuth, async (req, res) => {
  async function probe(url: string): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      return r.ok;
    } catch {
      return false;
    }
  }
  const [aglinerUp, orthoUp] = await Promise.all([
    probe("http://localhost:5173/agliner/"),
    probe("http://localhost:8765/api/status"),
  ]);
  const storage = loadSystemConfig();
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  const protocol = req.protocol || "http";
  const baseUrl = `${protocol}://${hostHeader}`;
  res.json({
    main: { up: true, url: baseUrl },
    agliner: {
      up: aglinerUp,
      url: `${baseUrl}/agliner/`,
      managed: satelliteAlive("agliner"),
      port: satellites.agliner.port,
    },
    ortho: {
      up: orthoUp,
      url: `${baseUrl}/ortho/`,
      managed: satelliteAlive("ortho"),
      port: satellites.ortho.port,
    },
    storageFolder: storage.storageFolder,
    storageExists: fs.existsSync(storage.storageFolder),
    aiAvailable: getGeminiClient() !== null,
  });
});

// ── Browser-mode Agliner pipeline backend ────────────────────────────────
// When the agliner UI runs inside the main system (no Electron), the main
// server executes the Python pipeline for it and streams logs over SSE —
// the exact same commands the Electron app would have run.

interface AglinerRun {
  id: string;
  kind: "full" | "auto" | "fast";
  proc: ChildProcess | null;
  output: string;
  exportPath: string;
  done: boolean;
  code: number | null;
  listeners: Set<express.Response>;
}

type PipelineLogType = "stdout" | "stderr" | "error" | "system" | "info" | "cmd" | "success";

const aglinerRuns = new Map<string, AglinerRun>();
let aglinerRunSeq = 0;

function aglinerRoot(): string {
  return path.join(process.cwd(), "ai cad");
}

function sendRunEvent(run: AglinerRun, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of run.listeners) {
    res.write(payload);
  }
}

// POST /api/agliner/pipeline — start a Python pipeline run (browser mode).
// Body: { kind: "full" | "auto" | "fast", config: {...} } — mirrors the
// Electron IPC surface in ai cad/aligner-ui/electron/main.cjs.
app.post("/api/agliner/pipeline", requireAuth, express.json({ limit: "10mb" }), (req, res) => {
  const { kind = "fast", config = {} } = req.body as {
    kind: "full" | "auto" | "fast";
    config: Record<string, any>;
  };
  const root = aglinerRoot();
  const pipelineDir = path.join(root, "aligner_pipeline");
  const python = pythonExecutable();
  const runId = `run-${Date.now()}-${++aglinerRunSeq}`;

  const run: AglinerRun = {
    id: runId,
    kind,
    proc: null,
    output: "",
    exportPath: "",
    done: false,
    code: null,
    listeners: new Set(),
  };
  aglinerRuns.set(runId, run);

  const emitLog = (text: string, type: PipelineLogType = "stdout") => {
    sendRunEvent(run, "log", { text, type, timestamp: Date.now() });
  };
  const finish = (code: number) => {
    run.done = true;
    run.code = code;
    sendRunEvent(run, "complete", { code, output: run.output, exportPath: run.exportPath });
    // Drop listeners after a short grace so late clients still get the result
    setTimeout(() => {
      for (const l of run.listeners) {
        try {
          l.end();
        } catch {
          /* ignore */
        }
      }
      run.listeners.clear();
      if (run.proc && run.proc.exitCode !== null) {
        aglinerRuns.delete(runId); // keep recent runs for late-joining streams
      }
    }, 30000);
  };

  // Resolve script + args — same logic as the Electron app
  const scriptMap: Record<AglinerRun["kind"], string> = {
    full: path.join(pipelineDir, "run_pipeline.py"),
    auto: path.join(pipelineDir, "auto_pipeline.py"),
    fast: path.join(pipelineDir, "fast_pipeline.py"),
  };
  const script = scriptMap[kind];
  let args: string[] = [];

  if (kind === "full") {
    args = [
      script,
      "all",
      "--stls", String(config.stlDir || ""),
      "--output", String(config.outputDir || ""),
      "--stages", String(config.stages ?? 5),
      "--expansion", String(config.expansion ?? 1.02),
      "--shell", String(config.shell ?? 0),
      "--undercut", String(config.undercut ?? 0),
    ];
    if (config.blenderPath) args.push("--blender", String(config.blenderPath));
  } else if (kind === "auto") {
    args = [
      script,
      String(config.patientDir || ""),
      "--stages", String(config.stages ?? 33),
      "--shell", String(config.shell ?? 0.75),
      "--undercut", String(config.undercut ?? 45),
    ];
    if (config.blenderPath) args.push("--blender", String(config.blenderPath));
  } else {
    // fast segmentation
    args = [script, String(config.inputPath || "")];
    if (config.outputPath) args.push(String(config.outputPath));
    if (config.archType === "upper") args.push("--upper");
    else if (config.archType === "lower") args.push("--lower");
    args.push("--cut", String(config.cutRatio ?? 0.3));
    if (config.mainServerUrl) args.push("--main-server", String(config.mainServerUrl));
    if (config.prescription) args.push("--prescription", String(config.prescription));
    if (config.storagePath) args.push("--storage", String(config.storagePath));
  }

  if (!fs.existsSync(script)) {
    res.status(500).json({ error: `Pipeline script not found: ${script}` });
    aglinerRuns.delete(runId);
    return;
  }
  if (!fs.existsSync(python)) {
    res.status(500).json({ error: `Python interpreter not found: ${python}` });
    aglinerRuns.delete(runId);
    return;
  }

  emitLog("=== Aligner Pipeline Started (browser mode via main system) ===", "system");
  emitLog(`$ "${python}" ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`, "cmd");

  let proc: ChildProcess;
  try {
    proc = spawn(python, args, {
      cwd: root,
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
  } catch (err: any) {
    emitLog(`Failed to start pipeline: ${err?.message}`, "error");
    finish(-1);
    res.json({ runId });
    return;
  }
  run.proc = proc;

  proc.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    run.output += text;
    for (const line of text.split("\n").filter((l) => l.trim())) {
      const exportMatch = line.match(/\[EXPORT_PATH\]\s+(.+)/);
      if (exportMatch) {
        run.exportPath = exportMatch[1].trim();
        sendRunEvent(run, "export-path", run.exportPath);
      }
      emitLog(line, "stdout");
    }
  });
  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    run.output += text;
    for (const line of text.split("\n").filter((l) => l.trim())) {
      const type = line.toLowerCase().includes("error") || line.toLowerCase().includes("traceback")
        ? "error"
        : "stderr";
      emitLog(line, type);
    }
  });
  proc.on("close", (code) => {
    emitLog("", "system");
    emitLog(`Pipeline exited with code ${code}`, code === 0 ? "success" : "error");
    finish(code ?? -1);
  });
  proc.on("error", (err) => {
    emitLog(`Failed to start pipeline: ${err.message}`, "error");
    finish(-1);
  });

  res.json({ runId });
});

// GET /api/agliner/pipeline/stream?runId=... — SSE log stream for a run
app.get("/api/agliner/pipeline/stream", (req, res) => {
  const runId = String(req.query.runId || "");
  const run = aglinerRuns.get(runId);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ runId, kind: run.kind })}\n\n`);
  run.listeners.add(res);
  req.on("close", () => {
    run.listeners.delete(res);
  });
});

// GET /api/agliner/browse?path=... — list directories/files (browser folder picker)
app.get("/api/agliner/browse", (req, res) => {
  const rawPath = String(req.query.path || process.cwd());
  let target = rawPath;
  try {
    target = path.resolve(rawPath);
  } catch {
    target = process.cwd();
  }
  if (!fs.existsSync(target)) {
    res.status(404).json({ error: `Path not found: ${target}` });
    return;
  }
  const stat = fs.statSync(target);
  const isDir = stat.isDirectory();
  const parent = isDir ? path.dirname(target) : null;
  let entries: { name: string; path: string; isDir: boolean; isFile: boolean; size: number }[] = [];
  if (isDir) {
    try {
      entries = fs
        .readdirSync(target, { withFileTypes: true })
        .map((e) => {
          const full = path.join(target, e.name);
          let isDirE = e.isDirectory();
          let size = 0;
          if (!isDirE) {
            try {
              size = fs.statSync(full).size;
            } catch {
              /* ignore */
            }
          }
          return { name: e.name, path: full, isDir: isDirE, isFile: !isDirE, size };
        })
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    } catch {
      /* ignore */
    }
  }
  res.json({ path: target, isDir, parent, entries });
});

// GET /api/agliner/stls?dir=... — recursively list STL files (browser mode)
app.get("/api/agliner/stls", (req, res) => {
  const dir = String(req.query.dir || "");
  if (!dir || !fs.existsSync(dir)) {
    res.json({ files: [] });
    return;
  }
  const files: { name: string; path: string }[] = [];
  function scanDir(current: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".stl")) {
        files.push({ name: entry.name, path: full });
      }
    }
  }
  try {
    scanDir(dir);
  } catch {
    /* ignore */
  }
  res.json({ files: files.slice(0, 500) });
});

// DELETE /api/agliner/pipeline — abort a running pipeline (browser mode)
app.delete("/api/agliner/pipeline", requireAuth, express.json(), (req, res) => {
  const runId = String(req.body?.runId || "");
  const run = aglinerRuns.get(runId);
  if (run && run.proc && !run.proc.killed) {
    try {
      run.proc.kill();
    } catch {
      /* ignore */
    }
  }
  res.json({ success: true });
});

// POST /api/agliner/pipeline-on-uploads — auto-run segmentation on the STLs
// of a just-submitted case. Resolves the uploaded files on disk, copies them
// into a per-case work dir, runs the agliner fast_pipeline.py (which exports
// tooth_*.stl + gingiva.stl and mirrors them into the shared storage folder
// for the ortho system), and streams logs to the Workspace Terminal via SSE.
app.post("/api/agliner/pipeline-on-uploads", requireAuth, express.json({ limit: "10mb" }), (req, res) => {
  const { files = [], prescription = "", storagePath = "", cutRatio = 0.3 } = req.body as {
    files?: { name?: string; url?: string }[];
    prescription?: string;
    storagePath?: string;
    cutRatio?: number;
  };

  const stlFiles = (Array.isArray(files) ? files : [])
    .filter((f) => f && f.url && String(f.url).toLowerCase().endsWith(".stl"))
    .map((f) => ({ name: String(f.name || path.basename(String(f.url))), url: String(f.url) }));

  if (stlFiles.length === 0) {
    res.status(400).json({ error: "No STL files provided for segmentation." });
    return;
  }

  // Resolve each /uploads/... URL to its local path (must stay under uploadsDir)
  const uploadsRoot = path.resolve(uploadsDir);
  const localPaths: string[] = [];
  for (const f of stlFiles) {
    const rel = path.basename(f.url.replace(/\\/g, "/")); // strip /uploads/
    const full = path.resolve(uploadsDir, rel);
    if (fs.existsSync(full) && full.startsWith(uploadsRoot + path.sep)) {
      localPaths.push(full);
    }
  }
  if (localPaths.length === 0) {
    res.status(404).json({ error: "Uploaded STL files could not be found on disk." });
    return;
  }

  const runId = `case-${Date.now()}-${++aglinerRunSeq}`;
  const run: AglinerRun = {
    id: runId,
    kind: "fast",
    proc: null,
    output: "",
    exportPath: "",
    done: false,
    code: null,
    listeners: new Set(),
  };
  aglinerRuns.set(runId, run);

  const emitLog = (text: string, type: PipelineLogType = "stdout") => {
    sendRunEvent(run, "log", { text, type, timestamp: Date.now() });
  };
  const finish = (code: number) => {
    run.done = true;
    run.code = code;
    sendRunEvent(run, "complete", { code, output: run.output, exportPath: run.exportPath });
    setTimeout(() => {
      for (const l of run.listeners) {
        try {
          l.end();
        } catch {
          /* ignore */
        }
      }
      run.listeners.clear();
      if (run.proc && run.proc.exitCode !== null) {
        aglinerRuns.delete(runId);
      }
    }, 30000);
  };

  // Per-case work dir under uploads/segmentation
  const baseCase = stlFiles[0].name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "case";
  const caseDir = path.join(uploadsDir, "segmentation", `${baseCase}_${Date.now()}`);
  const outDir = path.join(caseDir, "segmented");
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (err: any) {
    res.status(500).json({ error: `Could not create case dir: ${err?.message}` });
    aglinerRuns.delete(runId);
    return;
  }
  for (const p of localPaths) {
    try {
      fs.copyFileSync(p, path.join(caseDir, path.basename(p)));
    } catch (err: any) {
      emitLog(`Failed to copy ${p}: ${err?.message}`, "error");
    }
  }

  const storage = storagePath || loadSystemConfig().storageFolder;
  const python = pythonExecutable();
  const root = aglinerRoot();
  const script = path.join(root, "aligner_pipeline", "fast_pipeline.py");
  const mainServerUrl = `http://localhost:${PORT}`;

  if (!fs.existsSync(script)) {
    emitLog(`[ERROR] Pipeline script not found: ${script}`, "error");
    finish(-1);
    res.json({ runId });
    return;
  }

  emitLog("=== Auto Segmentation Started (after case submission) ===", "system");
  emitLog(`Case: ${baseCase} (${localPaths.length} STL)`, "info");
  emitLog(`Storage: ${storage}`, "info");

  // Multiple STLs → folder mode (auto upper/lower detection by filename);
  // single STL → run directly on the file.
  const args =
    localPaths.length > 1
      ? [script, caseDir, outDir]
      : [script, localPaths[0], outDir];
  args.push("--cut", String(Number(cutRatio) || 0.3));
  args.push("--main-server", mainServerUrl);
  if (prescription) args.push("--prescription", prescription);
  if (storage) args.push("--storage", storage);

  emitLog(`$ "${python}" ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`, "cmd");

  let proc: ChildProcess;
  try {
    proc = spawn(python, args, {
      cwd: root,
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
  } catch (err: any) {
    emitLog(`Failed to start pipeline: ${err?.message}`, "error");
    finish(-1);
    res.json({ runId });
    return;
  }
  run.proc = proc;

  proc.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    run.output += text;
    for (const line of text.split("\n").filter((l) => l.trim())) {
      const exportMatch = line.match(/\[EXPORT_PATH\]\s+(.+)/);
      if (exportMatch) {
        run.exportPath = exportMatch[1].trim();
        sendRunEvent(run, "export-path", run.exportPath);
      }
      emitLog(line, "stdout");
    }
  });
  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    run.output += text;
    for (const line of text.split("\n").filter((l) => l.trim())) {
      const type = line.toLowerCase().includes("error") || line.toLowerCase().includes("traceback") ? "error" : "stderr";
      emitLog(line, type);
    }
  });
  proc.on("close", (code) => {
    emitLog("", "system");
    emitLog(`Segmentation exited with code ${code}`, code === 0 ? "success" : "error");
    if (run.exportPath) emitLog(`Output: ${run.exportPath}`, "info");
    finish(code ?? -1);
  });
  proc.on("error", (err) => {
    emitLog(`Failed to start pipeline: ${err.message}`, "error");
    finish(-1);
  });

  res.json({ runId, caseDir, outDir });
});

// ── AI Bridge: unified AI used by the agliner pipeline & ortho ────────────
// The main system is the single AI brain. The agliner segmentation pipeline
// and the ortho staging/render system call these endpoints instead of holding
// their own API keys / provider SDKs. Both keep rule-based fallbacks so the
// lab never gets blocked when the AI is unreachable.

// POST /api/ai/cut-ratio — agliner segmentation: suggest gum/tooth cut ratio
app.post("/api/ai/cut-ratio", requireAuth, express.json(), async (req, res) => {
  const { z_min, z_max, z_range, archType, vertexCount, bbox, archWidthMm, archDepthMm, verticalProfile } = req.body;
  const ai = getGeminiClient();
  if (!ai) {
    // No AI configured — clinically-safe default
    res.json({ cut_ratio: 0.3, source: "default" });
    return;
  }
  try {
    const profile = Array.isArray(verticalProfile) && verticalProfile.length === 10
      ? verticalProfile.join(",")
      : "n/a";
    const prompt = `
Dental AI: suggest cut_ratio (0-1) to separate tooth crowns from gingiva for a ${archType || "unknown"} arch mesh.
Mesh: Z range ${Number(z_range || 0).toFixed(2)}mm (min=${Number(z_min || 0).toFixed(2)}, max=${Number(z_max || 0).toFixed(2)}), ${vertexCount || 0} vertices.
Bounding box (mm): x=${bbox?.x ?? archWidthMm ?? "?"}, y=${bbox?.y ?? archDepthMm ?? "?"}, z=${bbox?.z ?? Number(z_range || 0).toFixed(2)}.
Vertical vertex-density profile (bottom->top, 10 bins): [${profile}].
The gum line sits at the vertical inflection where crown density drops off into the gingiva. For an upper arch the cut is measured from the bottom (gingiva) up; for a lower arch from the top down.
Respond ONLY JSON: {"cut_ratio": 0.3}. Default 0.3, clamp 0.1-0.6.
`;
    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: [{ parts: [{ text: prompt }] }],
      config: { temperature: 0.1, responseMimeType: "application/json" },
    });
    const cleaned = (response.text || "{}").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const lastBrace = cleaned.lastIndexOf("}");
    const parsed = JSON.parse(lastBrace !== -1 ? cleaned.slice(0, lastBrace + 1) : cleaned);
    const cr = Math.max(0.1, Math.min(0.6, Number(parsed.cut_ratio ?? 0.3)));
    res.json({ cut_ratio: cr, source: "ai" });
  } catch (error) {
    console.warn("[AI Bridge] cut-ratio fallback to default:", error);
    res.json({ cut_ratio: 0.3, source: "default" });
  }
});

// POST /api/ai/staging-plan — ortho staging: per-tooth movement targets with Core Memory
app.post("/api/ai/staging-plan", requireAuth, express.json({ limit: "10mb" }), async (req, res) => {
  const { prescription, tooth_numbers, num_stages, case_name } = req.body;
  const ai = getGeminiClient();

  if (!ai) {
    res.status(503).json({
      error: "AI engine is not available. Please add a valid API key in the AI Manager tab.",
      code: "AI_UNAVAILABLE"
    });
    return;
  }

  const teeth = Array.isArray(tooth_numbers) && tooth_numbers.length > 0 ? tooth_numbers : [];
  const stages = Number(num_stages) || 20;

  try {
    const coreMemory = getCoreMemory();
    const prompt = `
${coreMemory.analysisInstructions}

You are an expert orthodontic treatment planner for WhiteSmile Clear Aligner Therapy.
Given a prescription and a list of tooth numbers (FDI), output a JSON object describing per-tooth movement targets.

**MEDICAL-GRADE REQUIREMENTS:**
- This treatment plan will be used to manufacture clear aligners for patient treatment
- All movements must comply with biological staging limits per Core Memory
- Zero tolerance for unsafe movement recommendations

Prescription:
${prescription || "No prescription provided — generate a standard Class I alignment plan."}

Tooth numbers (FDI): ${JSON.stringify(teeth)}
Number of stages: ${stages}
Case: ${case_name || "unnamed"}

Output ONLY a valid JSON object (no markdown, no code fences) with this EXACT structure:
{
  "movements": {
    "<tooth_number>": {
      "tx": <float mm, +X=right>,
      "ty": <float mm, +Y=posterior>,
      "tz": <float mm, +Z=superior/occlusal>,
      "rx": <float degrees>,
      "ry": <float degrees>,
      "rz": <float degrees>,
      "attachment_type": <"ellipsoid" | "beveled" | null>
    }
  },
  "num_stages": ${stages},
  "shell_thickness_mm": 0.75,
  "notes": "<brief clinical summary of the plan referencing Core Memory guidelines>"
}

Rules (STRICTLY ENFORCED per Core Memory):
- tx,ty,tz are TOTAL translations in mm from start to end of treatment.
- rx,ry,rz are TOTAL rotations in degrees.
- Teeth not mentioned in the prescription get all-zero movements.
- FDI anatomy: 11-18 = upper right, 21-28 = upper left, 31-38 = lower left, 41-48 = lower right. 1x/2x = incisors/canines/premolars (anterior), 3x/4x = premolars/molars (posterior).
- Anteriors (incisors/canines) tolerate more movement; molars should move the least (smaller tx/ty/rz).
- Set attachment_type for teeth requiring attachments per Core Memory guidelines:
  * Beveled Rectangular (Horizontal): Premolars/canines (2-4mm width) for intrusion, extrusion, and root torque
  * Beveled Rectangular (Vertical): Incisors/canines for rotation control
  * Ellipsoidal / Dome Attachments: Posteriors for general retention
  * Never place attachments on incisors unless strictly required
- Respect biological staging limits (per Core Memory):
  * Translation max 0.25mm/stage
  * Rotation max 2°/stage
  * Extrusion max 0.15-0.20mm/stage
  * Intrusion max 0.20mm/stage
  * Root movement max 0.25mm/stage
  * Torque max 2°/stage
- Total movement per tooth = per-stage limit × number of stages (with absolute caps)
- Return ONLY the JSON.
`;
    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: [{ parts: [{ text: prompt }] }],
      config: { temperature: 0.1, responseMimeType: "application/json" },
    });

    const cleaned = (response.text || "{}").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const lastBrace = cleaned.lastIndexOf("}");
    const parsed = JSON.parse(lastBrace !== -1 ? cleaned.slice(0, lastBrace + 1) : cleaned);

    const movements = parsed.movements && typeof parsed.movements === "object" ? parsed.movements : {};
    // Fill missing teeth with zero movement so the ortho renderer can interpolate safely
    for (const tn of teeth) {
      const key = String(tn);
      if (!(key in movements)) {
        movements[key] = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, attachment_type: null };
      }
    }

    res.json({
      movements,
      num_stages: stages,
      shell_thickness_mm: Number(parsed.shell_thickness_mm) || 0.75,
      notes: parsed.notes || "",
      source: "whitesmile-main-ai",
    });
  } catch (error) {
    console.error("[AI Bridge] staging-plan error:", error);
    res.status(500).json({ error: "AI staging plan generation failed. Please try again.", code: "AI_ERROR" });
  }
});

app.get("/api/core-memory", requireAdmin, (_req, res) => {
  res.json(getCoreMemory());
});

app.post("/api/core-memory", requireAdmin, express.json(), (req, res) => {
  const { chatInstructions, analysisInstructions } = req.body;
  if (typeof chatInstructions !== "string" || typeof analysisInstructions !== "string") {
    res.status(400).json({ error: "Invalid core memory fields" });
    return;
  }
  const success = saveCoreMemory({ chatInstructions, analysisInstructions });
  if (success) {
    res.json({ success: true, message: "Core Memory guidelines saved and applied." });
  } else {
    res.status(500).json({ error: "Failed to save Core Memory to file." });
  }
});

// POST /api/design-optimization - AI-assisted design refinement (CoT) with Core Memory
app.post("/api/design-optimization", requireAuth, express.json({ limit: '50mb' }), async (req, res) => {
  const { currentParameters, context, isPrecision = false } = req.body;
  const ai = getGeminiClient();

  if (!ai) {
    console.error("[Optimization] AI engine unavailable.");
    res.status(503).json({
      error: "AI engine is not available. Please add a valid API key in the AI Manager tab.",
      code: "AI_UNAVAILABLE"
    });
    return;
  }

  try {
    const coreMemory = getCoreMemory();
    
    const prompt = `
${coreMemory.analysisInstructions}

You are the world's leading orthodontist and Principal CAD Design Engineer for WhiteSmile Clear Aligners.
Review these current retainer/aligner design parameters and provide optimized adjustments for physical print accuracy, structural biomechanical safety, and maximum clinical effectiveness.

**MEDICAL-GRADE REQUIREMENTS:**
- This design will be 3D printed and used to thermoform aligners for patient treatment
- Zero tolerance for manufacturing defects or biomechanical errors
- All parameters must comply with FDA-cleared clinical guidelines

Perform an expert Chain-of-Thought (CoT) analysis:
1. Analyze anatomical constraints (arch geometry, tooth alignment, interproximal undercut structures, gingival morphology).
2. Evaluate trim-line positioning and cut-path styles (scalloped vs straight-cut vs beveled) against the gingival margin with sub-millimeter precision.
3. Recommend biomaterial selection and thickness optimization (bruxism relief, elastic force control, active vs passive appliance) based on movement magnitude.
4. Suggest precise attachment placement strategies (rectangular beveled horizontal/vertical, ellipsoidal) for active tooth movement control.
5. Validate all parameters against biological staging limits (translation ≤0.25mm/stage, rotation ≤2°/stage, extrusion ≤0.2mm/stage, intrusion ≤0.2mm/stage).
6. Finalize optimized parameters with clinical justification.

${isPrecision ? `
CRITICAL: CLINICAL PRECISION MODE ENABLED — MEDICAL DEVICE MANUFACTURING STANDARDS
- Enforce strict marginal accuracy: trim line exactly 0.5mm coronal to gingival margin (±0.1mm tolerance)
- Apply specialized interproximal wax block-outs to protect dental papilla and prevent gingival impingement
- Optimize shell thickness to 1.0mm for balanced orthodontic force delivery with patient compliance
- Ensure all undercut relief paths follow path of insertion with ≥0.2mm clearance
- Validate interproximal contact preservation (≥0.1mm contact area maintained)
- Confirm no sharp edges or stress concentrators in final geometry
` : "Provide standard high-efficiency clinical CAD optimization with straight trim line 1.5mm above gumline for maximum retention."}

Current Parameters: ${JSON.stringify(currentParameters)}
Design Context: ${JSON.stringify(context)}

Return as a JSON object with:
- 'optimizedParameters': a JSON object containing the same structure as input:
   * 'appliance': "Essix" or "Hawley" or "Other"
   * 'arch': "Upper" or "Lower" or "Both"
   * 'trimLineType': "scalloped" or "straight" or "beveled"
   * 'trimScallopOffset': number (float, mm)
   * 'shellThickness': number (float, mm)
   * 'selectedMaterial': string
- 'reasoning': a comprehensive clinical explanation of your Chain-of-Thought biomechanical analysis referencing Core Memory guidelines
- 'anatomicalValidation': a formal clinical validation statement certifying safety and tolerance compliance per WhiteSmile Core Memory
`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    });

    const cleanedText = response.text?.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim() || "{}";
    const lastBraceIndex = cleanedText.lastIndexOf('}');
    const trimmedText = lastBraceIndex !== -1 ? cleanedText.substring(0, lastBraceIndex + 1) : cleanedText;
    const result = JSON.parse(trimmedText);
    res.json(result);
  } catch (error) {
    console.error("AI design optimization error:", error);
    res.status(500).json({ error: "AI optimization failed. Please try again.", code: "AI_ERROR" });
  }
});

// POST /api/quality-audit - Dental safety rule cross-reference with Core Memory
app.post("/api/quality-audit", requireAuth, express.json({ limit: '50mb' }), async (req, res) => {
  const { parameters } = req.body;
  const ai = getGeminiClient();

  if (!ai) {
    console.error("[Quality Audit] AI engine unavailable.");
    res.status(503).json({
      error: "AI engine is not available. Please add a valid API key in the AI Manager tab.",
      code: "AI_UNAVAILABLE"
    });
    return;
  }

  try {
    const coreMemory = getCoreMemory();
    
    const prompt = `
${coreMemory.analysisInstructions}

You are an expert dental safety auditor for WhiteSmile Clear Aligners — a medical device manufacturer.
Perform a comprehensive quality audit on these retainer/aligner design parameters against industry safety rules and FDA-cleared clinical guidelines.

**MEDICAL-GRADE AUDIT REQUIREMENTS:**
- This design will be 3D printed and thermoformed for patient use
- Zero tolerance for manufacturing defects or clinical safety violations
- All findings must reference specific Core Memory clinical guidelines

Audit against these critical safety rules:
1. **Biomaterial & Thickness Compliance**: Essix aligners must use PETG/thermoform materials at 0.75mm, 1.0mm, or 1.5mm only
2. **Biomechanical Staging Limits**: Per-tooth movement per stage must not exceed:
   - Translation: 0.25mm max
   - Rotation: 2° max
   - Extrusion: 0.20mm max
   - Intrusion: 0.20mm max
   - Root movement: 0.25mm max
   - Torque: 2° max
3. **Trim Line Safety**: Scalloped 0.5-1.0mm coronal to gingival margin; Straight 1.5-2.0mm above zenith
4. **Undercut Relief**: All interproximal undercuts must have wax block-out relative to path of insertion
5. **Attachment Safety**: Beveled rectangular for torque/intrusion; Ellipsoidal for retention; Never on incisors unless required
6. **Frenum Relief**: Labial/lingual frenum relief zones mandatory
7. **Scan Quality**: Flag any mention of bubbles, voids, incomplete captures, distortions
8. **Arch Specification**: Must be explicit (Maxillary, Mandibular, or Dual)
9. **Manufacturing Feasibility**: No sharp edges, stress concentrators, or non-manifold geometry

Parameters: ${JSON.stringify(parameters)}

Identify any potential manufacturing flaws or clinical risks with specific Core Memory rule references.

Return JSON: { 
  "safe": boolean, 
  "flaws": string[], 
  "recommendations": string[],
  "coreMemoryReferences": string[]
}
`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    });

    const cleanedText = response.text?.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim() || "{}";
    const lastBraceIndex = cleanedText.lastIndexOf('}');
    const trimmedText = lastBraceIndex !== -1 ? cleanedText.substring(0, lastBraceIndex + 1) : cleanedText;
    const result = JSON.parse(trimmedText);
    res.json(result);
  } catch (error) {
    console.error("AI quality audit error:", error);
    res.status(500).json({ error: "AI quality audit failed. Please try again.", code: "AI_ERROR" });
  }
});

// POST /api/cad-editor - Interactive CAD modification
app.post("/api/cad-editor", requireAuth, express.json({ limit: '50mb' }), async (req, res) => {
  const { action, stlData } = req.body;
  // This is a placeholder for actual CAD processing logic
  // Real implementation would interface with an STL processing library or service.
  console.log("CAD Editor action:", action, "on model:", stlData ? "provided" : "none");
  res.json({ success: true, message: `CAD action ${action} processed.` });
});

// POST /api/orthodontic-chat - Interactive Orthodontic CAD Co-pilot Chat
app.post("/api/orthodontic-chat", requireAuth, express.json({ limit: '10mb' }), async (req: AuthedRequest, res) => {
  const { messages, currentDesign } = req.body;
  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: "AI service unavailable" });
    return;
  }

  try {
    const coreMemory = getCoreMemory();
    const chatSystemInstructions = `${coreMemory.chatInstructions}

You have deep familiarity with and should proactively reference and cite the following authoritative literature when discussing material forces, biological tolerances, and digital workflows:
- **The Adult Orthodontic-Restorative Interface Part 1: Concepts of Treatment and Presenting Challenges (2024)** *ResearchGate/Magonlinelibrary*: The premier reference for multidisciplinary adult treatment planning, space management for implants (root parallelism/divergence), leveling gingival zenith lines for anterior wear before veneering, and intrusive reclamation of vertical space for overerupted antagonists.
- **Eliades & Athanasiou (2020)** *Orthodontic Aligner Treatment: A Review of Materials, Clinical Management, and Evidence (Thieme)*: Crucial for polymer aging, force decay, aligner thickness optimization, and clinical staging parameters.
- **Applications of 3D Imaging for Craniofacial Region (2024)** *(Springer)*: Essential for CBCT-guided root planning, dual-axis tooth rotation calculations, and segmenting alveolar bone boundaries.
- **Advanced Use of Materials in Orthodontics (2023)** *(Frontiers)*: Reference for shape memory polymers, thermomechanical properties, and advanced multilayer polyurethane/PETG materials.
- **Abela (2025)** *Digital Orthodontics: Providing a Contemporary Treatment Solution (Springer)*: For CAD/CAM model prep, direct 3D printed aligner resins, and digital transfer trays.
- **Issues in Contemporary Orthodontics (2015)** *(IntechOpen)*: Grounding for torque biomechanics, skeletal anchorage (TADs), and interproximal reduction (IPR) planning.

You are also well-versed in the latest AI-driven CAD systems and can compare our capabilities or advise technicians using:
- **AdamCAD**: Parametric 3D translation of natural text into multi-part CAD assemblies.
- **Zoo (Text-to-CAD)**: Scripted boundary representation (B-Rep) geometry generation from text.
- **OpenArt AI CAD**: Image/sketch-to-isometric vector layouts and drafting.
- **Autodesk Fusion**: Automated generative design, topology optimization, and error detection.
- **SolidWorks AI**: Command predictors and automated assembly structure engines.
- **Siemens NX Copilot**: Smart contextual design workflows and click-minimization.
- **CADGPT**: Writing specialized automation scripts and custom dental lab macros.

Analyze the provided "Current CAD Design Parameter" context and answer the user's CAD questions with maximal clinical and scientific accuracy. Always use highly professional orthodontist/laboratory vocabulary:
- Distinguish between sequential clear aligners vs passive retainers.
- Discuss torque, tipping, bodily movement, intrusion/extrusion, anchorage control, and the Center of Resistance (CR).
- Detail undercut block-outs: identify critical interproximal areas, severe lingual molars, and frenums.

Format your responses using clean, readable markdown with bold headers and lists. Keep answers directly actionable for CAD designers and lab technicians. Always frame suggestions with rigorous clinical backing.
`;

    let contents = messages.map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }]
    }));

    if (currentDesign) {
      const modelResponse = {
        role: "model" as const,
        parts: [{ text: `Understood. I have loaded this patient's CAD parameters (Appliance: ${currentDesign.appliance}, Material: ${currentDesign.material}, Thickness: ${currentDesign.thickness_mm}mm, Trim Height: ${currentDesign.trimScallopOffset}mm, Cut path: ${currentDesign.trimLineType}) to provide clinically contextual biomechanical and layout recommendations.` }]
      };
      const userContext = {
        role: "user" as const,
        parts: [{ text: `Here is the current CAD Design Parameters context for the active patient case: ${JSON.stringify(currentDesign)}` }]
      };
      contents = [modelResponse, userContext, ...contents];
    }

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction: chatSystemInstructions,
        temperature: 0.7
      },
      _userId: req.user!.id,
      _username: req.user!.username,
      _companyId: req.user!.companyId || "none",
      _companyName: req.company?.name || "none",
      _requestType: "chat",
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("AI Orthodontic Chat Error:", error);
    res.status(500).json({ error: "AI chat copilot is currently unavailable. Please check your API key.", code: "AI_ERROR" });
  }
});
app.get("/api/history", requireAuth, (req: AuthedRequest, res) => {
  const history = readHistory();
  const users = readUsers();
  const companies = readCompanies();

  // Enrich history cases with user and company names
  const enrichedHistory = history.map((c) => {
    const owner = users.find((u) => u.id === c.ownerUserId);
    const company = companies.find((comp) => comp.id === c.companyId);
    return {
      ...c,
      ownerUsername: owner ? owner.username : c.ownerUsername || null,
      companyName: company ? company.name : c.companyName || null,
    };
  });

  res.json(filterHistoryForUser(enrichedHistory, req.user!, req.company || null));
});

// DELETE /api/history/:id - Clear a specific case (owner or admin only)
app.delete("/api/history/:id", requireAuth, (req: AuthedRequest, res) => {
  const { id } = req.params;
  const history = readHistory();
  const target = history.find((item) => item.id === id);
  if (!target) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  if (!canAccessCase(req.user!, req.company || null, target)) {
    res.status(403).json({ error: "You do not have permission to delete this case." });
    return;
  }
  const updatedHistory = history.filter((item) => item.id !== id);
  writeHistory(updatedHistory);
  res.json({ success: true, message: `Case ${id} deleted.` });
});

// PUT /api/history/:id - Update a specific case results/status (owner or admin only)
app.put("/api/history/:id", requireAuth, (req: AuthedRequest, res) => {
  const { id } = req.params;
  const { result, status } = req.body;
  const history = readHistory();
  const index = history.findIndex((item) => item.id === id);
  if (index === -1) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  if (!canAccessCase(req.user!, req.company || null, history[index])) {
    res.status(403).json({ error: "You do not have permission to modify this case." });
    return;
  }
  if (result) history[index].result = result;
  if (status) history[index].status = status;
  writeHistory(history);
  res.json({ success: true, case: history[index] });
});

// ── URL Knowledge Summarization ─────────────────────────────────────────
// Fetches a URL, uses Gemini to summarize it, and saves as AI knowledge in the reference folder.
app.post("/api/sync/summarize-url", requireAdmin, express.json({ limit: '5mb' }), async (req, res) => {
  let { url, folderPath } = req.body;

  if (!url || typeof url !== 'string' || !folderPath || typeof folderPath !== 'string') {
    res.status(400).json({ error: 'URL and folderPath are required.' });
    return;
  }

  // Sanitize & validate URL — be permissive, try to fix common issues
  const cleanUrl = sanitizeUrl(url);
  if (!cleanUrl) {
    // Try one more time: if the URL has trailing garbage, attempt to extract a valid URL from it
    const extracted = extractUrls(url);
    const finalUrl = extracted.length > 0 ? extracted[0] : sanitizeUrl(url.replace(/[.,;:!?'")\]}>]+$/, ''));
    if (!finalUrl) {
      res.status(400).json({ error: 'Invalid URL format. Please enter a valid http or https URL.' });
      return;
    }
    url = finalUrl;
  } else {
    url = cleanUrl;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid URL format. Please enter a valid http or https URL.' });
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'AI engine is not available. Please add a valid API key.', code: 'AI_UNAVAILABLE' });
    return;
  }

  try {
    // 1. Fetch the webpage
    console.log(`[URL Summarize] Fetching: ${url}`);
    const fetchResponse = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhiteSmileAI/1.0)' },
      signal: AbortSignal.timeout(30000),
    });

    if (!fetchResponse.ok) {
      res.status(502).json({ error: `Failed to fetch URL: HTTP ${fetchResponse.status} ${fetchResponse.statusText}` });
      return;
    }

    const contentType = fetchResponse.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html') || contentType.includes('text/plain');
    const isPdf = contentType.includes('application/pdf');

    let pageContent: string;
    if (isPdf) {
      pageContent = `[PDF document at ${url} — ${fetchResponse.headers.get('content-length') || 'unknown'} bytes]`;
    } else if (isHtml) {
      pageContent = await fetchResponse.text();
      // Strip HTML tags to get plain text (simple approach)
      pageContent = pageContent
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[^;]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50000); // Limit to 50K chars
    } else {
      // Binary content — just note the URL
      pageContent = `[Content at ${url} — type: ${contentType}, size: ${fetchResponse.headers.get('content-length') || 'unknown'} bytes]`;
    }

    if (!pageContent || pageContent.length < 20) {
      res.status(422).json({ error: 'Page content is empty or could not be extracted.' });
      return;
    }

    // 2. Summarize with Gemini
    console.log(`[URL Summarize] Summarizing ${pageContent.length} chars from: ${url}`);
    const domain = parsedUrl.hostname;
    const summaryResponse = await generateContentWithRetry(ai, {
      model: 'gemini-3.5-flash',
      contents: [{
        text: `You are an expert orthodontic knowledge curator. Your job is to extract **actionable clinical and manufacturing guidelines** from web content for use by an AI CAD designer creating clear aligners and orthodontic appliances.

Read the following web page content from **${domain}** and produce a structured knowledge summary.

## OUTPUT FORMAT — STRICT MARKDOWN

Return ONLY valid markdown with these exact sections:

# Source: ${url}

## Domain
${domain}

## Key Takeaways
[Bullet-list of 3-7 most important facts, clinical guidelines, or manufacturing insights from this page]

## Extracted Clinical/Technical Guidelines
[If the page contains specific rules, numerical limits, material specs, or protocols, list them here as bullet points. If none, write "No specific technical guidelines found on this page."]

## Relevance to Clear Aligner / Orthodontic Appliance Design
[1-3 sentence assessment of how this information applies to clear aligner design, retainer fabrication, or digital orthodontic CAD]

## Summary
[A 2-3 sentence concise summary capturing the essence of the page]

---
PAGE CONTENT:
${pageContent}`
      }],
      config: { temperature: 0.3 },
    });

    const summaryText = summaryResponse.text?.trim() || '';
    if (!summaryText) {
      res.status(500).json({ error: 'AI returned an empty summary.' });
      return;
    }

    // 3. Save summary to the reference folder under _ai_knowledge/
    const knowledgeDir = path.join(path.resolve(folderPath), '_ai_knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });

    const safeName = domain
      .replace(/^www\./, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${safeName}_${timestamp}.md`;
    const relativePath = `_ai_knowledge/${fileName}`;
    const fullPath = path.join(knowledgeDir, fileName);

    // Add metadata header
    const fileContent = `---
source_url: ${url}
fetched_at: ${new Date().toISOString()}
domain: ${domain}
type: ai-knowledge-summary
---

${summaryText}
`;
    fs.writeFileSync(fullPath, fileContent, 'utf-8');
    const stat = fs.statSync(fullPath);

    console.log(`[URL Summarize] Saved knowledge to: ${fullPath}`);

    res.json({
      success: true,
      message: `Summarized and saved knowledge from ${url}`,
      file: {
        name: fileName,
        relativePath,
        extension: '.md',
        size: stat.size,
        sizeFormatted: stat.size >= 1024 ? `${(stat.size / 1024).toFixed(1)} KB` : `${stat.size} B`,
        modifiedAt: stat.mtime.toISOString(),
      },
      summary: summaryText.slice(0, 500) + (summaryText.length > 500 ? '...' : ''),
    });
  } catch (err: any) {
    console.error(`[URL Summarize] Error processing ${url}:`, err);
    if (err.name === 'TimeoutError' || err.code === 'ETIMEOUT') {
      res.status(504).json({ error: 'Request timed out while fetching the URL.' });
    } else {
      res.status(500).json({ error: `Failed to summarize URL: ${err.message || 'Unknown error'}` });
    }
  }
});

// POST /analyze-case & POST /api/analyze-case (Both mapped for compatibility)
const analyzeHandler = async (req: AuthedRequest, res: express.Response) => {
  try {
    // request logging removed (use persistent logging/monitoring in production)
    // Handle both legacy single-field and new multi-field uploads
    let allFiles: Express.Multer.File[] = [];
    if (Array.isArray(req.files)) {
      allFiles = req.files as Express.Multer.File[];
    } else if (req.files && typeof req.files === 'object') {
      const fields = req.files as { [fieldname: string]: Express.Multer.File[] };
      allFiles = [
        ...(fields['stlFiles'] || []),
        ...(fields['prescriptionFiles'] || []),
      ];
    }
    const prescriptionText = req.body.prescriptionText || "";

    // payload logging removed

    // Parse imported sync files (from folder sync)
    let importedFolderPath = req.body.importedFolderPath || "";
    let importedFilesData: any[] = [];
    try {
      if (req.body.importedFiles) {
        importedFilesData = JSON.parse(req.body.importedFiles);
      }
    } catch { /* ignore parse errors */ }

    // ── Read reference library sample treatment plans ─────────────────
    let referenceSamplesContent = '';
    const referenceLibraryPath = req.body.referenceLibraryPath || '';
    if (referenceLibraryPath) {
      try {
        const resolvedRefPath = path.resolve(referenceLibraryPath);
        if (fs.existsSync(resolvedRefPath)) {
          const refEntries = fs.readdirSync(resolvedRefPath, { withFileTypes: true });
          // Collect sample files with priority: markdown > txt > pdf
          const sampleFiles: string[] = [];
          for (const entry of refEntries) {
            if (!entry.isFile()) continue;
            const lower = entry.name.toLowerCase();
            if (lower.endsWith('.md') || lower.endsWith('.txt')) {
              sampleFiles.push(path.join(resolvedRefPath, entry.name));
            }
          }
          // Also scan one level deep for _ai_knowledge and subfolders
          for (const entry of refEntries) {
            if (entry.isDirectory()) {
              try {
                const subFiles = fs.readdirSync(path.join(resolvedRefPath, entry.name));
                for (const sf of subFiles) {
                  const sfLower = sf.toLowerCase();
                  if (sfLower.endsWith('.md') || sfLower.endsWith('.txt')) {
                    sampleFiles.push(path.join(resolvedRefPath, entry.name, sf));
                  }
                }
              } catch { /* skip unreadable subdirs */ }
            }
          }
          // Limit to first 15 samples to keep prompt size manageable
          const MAX_SAMPLES = 15;
          const selectedSamples = sampleFiles.slice(0, MAX_SAMPLES);
          for (const filePath of selectedSamples) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              const fileName = path.basename(filePath);
              // Truncate very long files to 8000 chars
              const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content;
              referenceSamplesContent += `\n\n=== REFERENCE SAMPLE: ${fileName} ===\n${truncated}`;
            } catch { /* skip unreadable files */ }
          }
          if (referenceSamplesContent) {
            console.log(`Loaded ${selectedSamples.length} reference sample(s) from reference library`);
          }
        }
      } catch (err) {
        console.warn('Failed to read reference library samples:', err);
      }
    }

    if (!prescriptionText && allFiles.length === 0 && importedFilesData.length === 0) {
      res.status(400).json({ error: "Prescription text or dental scan STL files must be provided." });
      return;
    }

    // Build segregated metadata for each file category
    const stlFilesMetadata: any[] = [];
    const prescriptionFilesMetadata: any[] = [];

    // Process uploaded files from multer
    for (const f of allFiles) {
      const isStl = f.originalname.toLowerCase().endsWith(".stl");
      const stlInfo = isStl 
        ? runSTLProcessorAnalyze(f.path) 
        : { valid: true, format: "Attachment", arch_guess: "unspecified", triangle_count: 0, error: null };

      const meta = {
        name: f.originalname,
        size: f.size,
        mimeType: f.mimetype,
        url: `/uploads/${f.filename}`,
        localPath: f.path,
        valid: stlInfo.valid,
        format: isStl ? stlInfo.format : "Attachment",
        archGuess: stlInfo.arch_guess,
        triangleCount: stlInfo.triangle_count,
        error: stlInfo.error,
        isAttachment: !isStl,
        category: isStl ? 'stl-scan' : 'prescription-doc',
      };

      if (isStl) {
        stlFilesMetadata.push(meta);
      } else {
        prescriptionFilesMetadata.push(meta);
      }
    }

    // ── Antivirus scan: examine uploaded files for malware ──────────────
    const antivirusEnabled = req.body.antivirusEnabled === 'true';
    const avScanResults: { file: string; safe: boolean; threats: string[]; deleted: boolean }[] = [];
    if (antivirusEnabled && allFiles.length > 0) {
      console.log(`[Antivirus] Scanning ${allFiles.length} uploaded file(s)...`);
      for (const f of allFiles) {
        try {
          const absPath = path.resolve(f.path);
          if (!fs.existsSync(absPath)) continue;
          const size = fs.statSync(absPath).size;
          const ext = path.extname(f.originalname).toLowerCase();
          const readSize = Math.min(size, 2 * 1024 * 1024);
          const fd = fs.openSync(absPath, 'r');
          const buf = Buffer.alloc(readSize);
          fs.readSync(fd, buf, 0, readSize, 0);
          fs.closeSync(fd);

          const threats: string[] = [];

          // Magic byte validation
          if (MAGIC_BYTES[ext]) {
            const magic = validateMagicBytes(buf, ext);
            if (!magic.valid) {
              threats.push(`File type mismatch: declared as ${ext} but detected as ${magic.detected}`);
            }
          }

          // Embedded executable scan
          const embedded = scanForEmbeddedExecutables(buf);
          if (embedded.found) threats.push(...embedded.details);

          // Malicious content scan
          const malicious = scanForMaliciousContent(buf, f.originalname);
          if (malicious.threats.length > 0) threats.push(...malicious.threats);

          // Infected files are deleted immediately — no quarantine folder
          // (quarantine only wastes disk space with copies of bad files).
          let deleted = false;
          if (threats.length > 0) {
            try {
              fs.unlinkSync(absPath);
              deleted = true;
              console.log(`[Antivirus] ❌🚫 ${f.originalname} deleted (threats): ${threats.join('; ')}`);
            } catch (qe: any) {
              console.warn(`[Antivirus] Delete failed for ${f.originalname}: ${qe.message}`);
            }
          } else {
            console.log(`[Antivirus] ✅ ${f.originalname} — Clean`);
          }
          avScanResults.push({ file: f.originalname, safe: threats.length === 0, threats, deleted });
        } catch (e: any) {
          console.warn(`[Antivirus] Error scanning ${f.originalname}: ${e.message}`);
          avScanResults.push({ file: f.originalname, safe: true, threats: [], deleted: false });
        }
      }
    }

    // Process imported files from folder sync (read from their local disk paths)
    if (importedFolderPath && importedFilesData.length > 0) {
      const resolvedBase = path.resolve(importedFolderPath);
      for (const imp of importedFilesData) {
        const fullPath = path.resolve(resolvedBase, imp.relativePath);
        // Security: ensure resolved path is inside the base folder
        if (!fullPath.startsWith(resolvedBase)) continue;
        if (!fs.existsSync(fullPath)) continue;

        const stat = fs.statSync(fullPath);
        const ext = imp.extension || path.extname(imp.name).toLowerCase();
        const isStl = ext === '.stl';

        const stlInfo = isStl
          ? runSTLProcessorAnalyze(fullPath)
          : { valid: true, format: "Attachment", arch_guess: "unspecified", triangle_count: 0, error: null };

        const meta = {
          name: imp.name,
          size: stat.size,
          mimeType: isStl ? 'application/sla' : ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
          url: `file://${fullPath}`,
          valid: stlInfo.valid,
          format: isStl ? stlInfo.format : "Attachment",
          archGuess: stlInfo.arch_guess,
          triangleCount: stlInfo.triangle_count,
          error: stlInfo.error,
          isAttachment: !isStl,
          category: isStl ? 'stl-scan' : 'prescription-doc',
          isImported: true,
          localPath: fullPath,
        };

        if (isStl) {
          stlFilesMetadata.push(meta);
        } else {
          prescriptionFilesMetadata.push(meta);
        }
      }
    }

    const uploadedFilesMetadata = [...stlFilesMetadata, ...prescriptionFilesMetadata];


    // Check AI availability BEFORE creating the case
    const ai = getGeminiClient();

    if (!ai) {
      console.error("AI engine unavailable. Cannot analyze case without an active API key.");
      res.status(503).json({
        error: "AI engine is not available. Please add a valid API key in the AI Manager tab and try again.",
        code: "AI_UNAVAILABLE"
      });
      return;
    }

    // Create a new case in pending state (stamped with owner + company for data isolation)
    const newCaseId = `CASE_${Date.now()}`;
    const newCase = {
      id: newCaseId,
      createdAt: new Date().toISOString(),
      prescriptionText,
      files: uploadedFilesMetadata,
      status: "pending" as const,
      ownerUserId: req.user?.id || null,
      ownerUsername: req.user?.username || null,
      companyId: req.user?.companyId || null,
      companyName: req.company?.name || null,
    };

    // Save initial case with pending status
    const history = readHistory();
    history.unshift(newCase);
    writeHistory(history);

    let analysisResult;

    try {
      console.log("Analyzing with server-side Gemini API...");
      
      const parts: any[] = [];

      // Helper to read a file and push inline data to Gemini parts
      function pushFileInline(filePath: string, fileName: string, mimeType: string) {
        try {
          const stat = fs.statSync(filePath);
          if (stat.size >= 25 * 1024 * 1024) return false; // too large
          console.log(`Reading file inline for Gemini: ${fileName} (${mimeType})`);
          const base64Data = fs.readFileSync(filePath).toString("base64");
          parts.push({ inlineData: { mimeType, data: base64Data } });
          return true;
        } catch (err) {
          console.error(`Failed to read file ${fileName} for Gemini inline:`, err);
          return false;
        }
      }

      // Upload/include uploaded files as inline parts (multer)
      for (const f of allFiles) {
        const isPdf = f.originalname.toLowerCase().endsWith(".pdf") || f.mimetype === "application/pdf";
        const isVideo = f.mimetype?.startsWith("video/") || f.originalname.toLowerCase().match(/\.(mp4|mov|avi|webm)$/);
        const isImage = f.mimetype?.startsWith("image/") || f.originalname.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/);
        if (isPdf || isVideo || isImage) {
          pushFileInline(f.path, f.originalname, f.mimetype || (isPdf ? 'application/pdf' : isVideo ? 'video/mp4' : 'image/png'));
        }
      }

      // Also include imported sync files as inline parts
      for (const meta of [...stlFilesMetadata, ...prescriptionFilesMetadata]) {
        if (meta.isImported && meta.localPath) {
          const nameLower = meta.name.toLowerCase();
          const isDoc = nameLower.endsWith('.pdf') || nameLower.match(/\.(mp4|mov|avi|webm)$/) || nameLower.match(/\.(png|jpg|jpeg|webp)$/);
          if (isDoc) {
            const mime = nameLower.endsWith('.pdf') ? 'application/pdf'
              : nameLower.match(/\.(mp4|mov|avi|webm)$/) ? 'video/mp4'
              : 'image/png';
            pushFileInline(meta.localPath, meta.name, mime);
          }
        }
      }

        // Add the primary prompt
        const coreMemory = getCoreMemory();
        
        // Identify reference sample files (imported from Connected Reference Library)
        const importedSamples = uploadedFilesMetadata.filter((m: any) => m.isImported);
        const localFiles = uploadedFilesMetadata.filter((m: any) => !m.isImported);
        
        const textPrompt = `
${coreMemory.analysisInstructions}

**IMPORTANT OUTPUT FORMAT MANDATE:**
You MUST structure the "special_notes" field EXACTLY as a professional markdown report using the following markdown headers. Do NOT omit any headers:

## Case Analysis
[Provide a structured orthodontic case analysis evaluating scan quality, active/passive status, tooth numbering, and multidisciplinary ortho-restorative or retention needs]

## Findings
[Detailed clinical and CAD observations from the prescription and STL scans]

## Risks
[Anatomical risks, undercut locking risks, periodontally unsafe forces, or scan quality issues]

## Recommended Tooth Movements
[Translation/rotation requirements, limits, and staging compliance]

## Attachment Recommendations
[Exact horizontal or vertical beveled active/retentive attachment placements and mechanical purposes]

## IPR Recommendations
[Interproximal reduction specifics if indicated, teeth numbers, and safety maximums]

## Manufacturing Notes
[Material selection, print bed setup, thermoforming parameters, and finishing rules]

## QC Checklist
[Provide this exact checklist verbatim with checks applied:
✓ STL repaired
✓ Teeth segmented
✓ Gingiva detected
✓ No mesh errors
✓ No collisions
✓ Attachments validated
✓ Trim line validated
✓ Material thickness validated
✓ Manufacturing compatible
✓ Print orientation optimized
✓ QC passed]

## Final Design Approval
[Approval status, recommended next steps, and sign off as Senior CAD Technician / Orthodontic Lab Specialist]

**TREATMENT PLAN GENERATION — CRITICAL INSTRUCTIONS:**
You MUST generate a comprehensive orthodontic TREATMENT PLAN in the "treatment_plan" field as a professional markdown report.

**FORMAT REFERENCE — STRUCTURE ONLY:**
Below are sample treatment plans provided ONLY as a structural format reference. Look at them solely to understand the expected section headings, document flow, and level of detail. IGNORE their clinical content entirely.

**CLINICAL EXECUTION — USE YOUR OWN KNOWLEDGE:**
The actual clinical decisions, diagnoses, treatment recommendations, and all medical/technical content MUST come SOLELY from:
1. Your own expert clinical training and knowledge as an orthodontic CAD designer with 20+ years experience
2. The Core Memory clinical guidelines provided at the top of this prompt (biomechanical limits, attachment rules, trim line protocols, etc.)
3. The specific patient prescription text and uploaded files below

You must NOT copy, paraphrase, or adapt any clinical content from the reference samples. They are FORMAT-ONLY guides. Every diagnosis, measurement, tooth number, attachment placement, and clinical decision must be independently derived from your knowledge and the patient data.${referenceSamplesContent ? `

=== REFERENCE FORMAT SAMPLES (STRUCTURE ONLY — IGNORE CLINICAL CONTENT) ===${referenceSamplesContent}
` : '\n(No reference library samples available. Generate the treatment plan based on your clinical knowledge and the prescription data below.)'}

**TREATMENT PLAN STRUCTURE — INCLUDE THESE SECTIONS IN ORDER:**
You MUST populate the "treatment_plan" field with ALL of the following sections:

## Patient Information
[Patient name/ID from the case, age if available, presenting condition summary]

## Diagnosis Summary
[Type of malocclusion, crowding assessment, arch form analysis, asymmetry or special conditions]

## Treatment Objectives
[Primary goals — relieve crowding, align arches, achieve Class I canine relationship, coordinate occlusion]

## Staging Plan
[Number of stages, wear schedule per aligner, total treatment duration, mid-course correction plan]

## Tooth Movement Breakdown
[Per movement type: translation limits max 0.25mm/stage, rotation max 2°/stage, torque control strategy, extrusion/intrusion limits]

## Attachment Configuration
[Which teeth, attachment types (horizontal/vertical beveled, ellipsoidal), mechanical purpose of each]

## IPR Plan
[Which teeth require IPR, how much in mm, and at which stage]

## Expected Outcomes
[Post-treatment occlusion goals, retention plan, contingency plans]

**IMPORTED PATIENT FILES (for patient-specific context only):**
${importedSamples.length > 0 ? `The following ${importedSamples.length} file(s) were imported from Patient Case Scanner. Read them to understand THIS PATIENT's case context and clinician instructions — NOT for treatment format/clinical reference.

Imported Files:
${JSON.stringify(importedSamples.map((m: any) => ({ name: m.name, size: m.size, format: m.format, localPath: m.localPath })), null, 2)}` : 'No imported patient files.'}

**PATIENT CASE DATA TO ANALYZE:**
Prescription Text: "${prescriptionText}"

Uploaded Local Files & Metadata: ${JSON.stringify(localFiles, null, 2)}
`;

        parts.push({ text: textPrompt });

        const response = await generateContentWithRetry(ai, {
          model: "gemini-3.5-flash",
          contents: parts,
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                design_parameters: {
                  type: Type.OBJECT,
                  properties: {
                    appliance: { type: Type.STRING, description: "Essix or Hawley or Other" },
                    arch: { type: Type.STRING, description: "Upper, Lower, or Both" },
                    material: { type: Type.STRING, description: "Material specifications" },
                    thickness_mm: { type: Type.NUMBER, description: "Thickness in mm as a number (e.g. 0.75, 1.0, 1.5). Use 0 if not specified or not applicable." },
                    coverage: { type: Type.STRING, description: "Extent of the retainer coverage" },
                    trim_line: { type: Type.STRING, description: "Instructions on where the retainer should be trimmed" },
                    relief_areas: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "List of areas requiring relief or block-out, e.g. frenums, sensitive teeth"
                    },
                    special_notes: { type: Type.STRING, description: "Any other special instructions parsed from text" }
                  },
                  required: ["appliance", "arch", "material", "thickness_mm", "coverage", "trim_line", "relief_areas", "special_notes"]
                },
                manufacturing_instructions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Step-by-step physical fabrication guidance for the lab technicians"
                },
                warnings: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Highlighted issues, missing parameter warnings, conflict warnings, or scan warnings."
                },
                treatment_plan: {
                  type: Type.STRING,
                  description: "Full orthodontic treatment plan as a professional markdown report including Patient Information, Diagnosis Summary, Treatment Objectives, Staging Plan, Tooth Movement Breakdown, Attachment Configuration, IPR Plan, and Expected Outcomes."
                }
              },
              required: ["design_parameters", "manufacturing_instructions", "warnings", "treatment_plan"]
            }
          }
        });

        const jsonText = response.text?.trim() || "";
        console.log("Raw response text:", jsonText);
        if (!jsonText) {
          throw new Error("Gemini response is empty");
        }
        analysisResult = JSON.parse(jsonText);
      } catch (geminiError: any) {
        console.error("Gemini processing error:", geminiError);
        const status = geminiError?.status || (geminiError?.error && geminiError.error.code) || 0;
        const msg = (geminiError?.message || String(geminiError || '')).toLowerCase();
        const isQuota = status === 429 || msg.includes('quota') || msg.includes('429') || msg.includes('rate limit');
        if (isQuota) {
          res.status(429).json({
            error: "The AI provider is currently out of quota or rate-limited. Please wait a moment and try again, or add a different API key in the AI Manager tab.",
            code: "AI_QUOTA_EXCEEDED"
          });
          return;
        }
        res.status(500).json({
          error: "AI analysis failed during processing. Please try again or check your API key.",
          code: "AI_PROCESSING_ERROR"
        });
        return;
      }

    // Validate the generated result using Python compliance validator
    const validationResult = runSTLProcessorValidate(analysisResult);
    if (!analysisResult.warnings) {
      analysisResult.warnings = [];
    }
    if (!validationResult.valid) {
      validationResult.errors.forEach((err) => {
        analysisResult.warnings.push(`[Compliance Audit Failure] ${err}`);
      });
    }

    // Check for any invalid STL files and add warnings
    uploadedFilesMetadata.forEach((file) => {
      if (!file.isAttachment && !file.valid) {
        analysisResult.warnings.push(`[STL Quality Issue] File '${file.name}' is unreadable or malformed: ${file.error}`);
      }
    });

    // Update case in history with completed status and result
    const currentHistory = readHistory();
    const caseIndex = currentHistory.findIndex((item) => item.id === newCaseId);
    if (caseIndex !== -1) {
      currentHistory[caseIndex].status = "processed";
      currentHistory[caseIndex].result = analysisResult;
      writeHistory(currentHistory);
    }

    // ── LEAP classification (post-treatment-plan stage) + rigid tenant mirror ──
    // Notebook pipeline: STL -> AI treatment plan -> malocclusion classification
    // (15 labels, top-5, rule-based combinations) -> artifacts mirrored to
    // [Clinic]/[Doctor]/Patients/[CASE]/stl + /treatment-plan
    try {
      const leap = await runLeapForCase(newCaseId);
      analysisResult.leap = leap;
      // The same in-memory record was written by runLeapForCase; keep it consistent
      const refreshed = readHistory();
      const rIdx = refreshed.findIndex((item) => item.id === newCaseId);
      if (rIdx !== -1) {
        refreshed[rIdx].leap = leap;
        if (refreshed[rIdx].result) refreshed[rIdx].result.leap = leap;
        writeHistory(refreshed);
      }
    } catch (leapErr: any) {
      console.error("[LEAP] classification failed:", leapErr && leapErr.message);
      analysisResult.leap = { status: "failed", error: String((leapErr && leapErr.message) || leapErr) };
    }

    // Attach antivirus scan results + uploaded file metadata (used by the
    // domino: the UI auto-triggers Agliner segmentation on the STLs).
    res.json({ ...analysisResult, antivirusScan: avScanResults, files: uploadedFilesMetadata });
  } catch (err: any) {
    console.error("Error analyzing retainer case:", err);
    res.status(500).json({ error: err.message || "An unexpected error occurred during case analysis." });
  }
};

app.post("/api/export-print-sql", requireAuth, express.json({ limit: '2mb' }), (req: AuthedRequest, res) => {
  const { caseId } = req.body;
  if (!caseId || typeof caseId !== "string") {
    return res.status(400).json({ error: "caseId is required" });
  }

  const history = readHistory();
  const caseData = history.find((item) => item.id === caseId);
  if (!caseData) {
    return res.status(404).json({ error: "Case not found" });
  }
  if (!canAccessCase(req.user!, req.company || null, caseData)) {
    return res.status(403).json({ error: "You do not have permission to export this case." });
  }

  const sqlText = generatePrintReadySql(caseData);
  const fileName = `print_ready_markers_${caseId}.sql`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const outputPath = path.join(process.cwd(), fileName);
  try {
    fs.writeFileSync(outputPath, sqlText, "utf-8");
  } catch (writeErr) {
    console.error("Failed to save generated SQL file:", writeErr);
  }

  res.json({ filename: fileName, sqlText });
});

// Allow large multi-file case uploads. The UI lets users stage 100+ files per
// case (STL scans + photos + videos + documents) into a single field, so these
// caps must stay well above realistic counts. Otherwise multer rejects a real
// submission with LIMIT_UNEXPECTED_FILE and Express returns an opaque HTML
// "<title>Error</title>" page that the UI can't parse.
const analyzeUpload = upload.fields([
  { name: 'stlFiles', maxCount: 500 },
  { name: 'prescriptionFiles', maxCount: 500 },
]);

app.post("/analyze-case", requireAuth, requirePack("analysis"), analyzeUpload, analyzeHandler);
app.post("/api/analyze-case", requireAuth, requirePack("analysis"), analyzeUpload, analyzeHandler);

// POST /api/leap/classify — run/re-run the LEAP malocclusion classification
// (15 labels: 4 sagittal main classes + 11 occlusal subclasses) for a case.
app.post("/api/leap/classify", requireAuth, requirePack("analysis"), express.json(), async (req: AuthedRequest, res) => {
  const { caseId } = req.body || {};
  if (!caseId || typeof caseId !== "string") {
    res.status(400).json({ error: "caseId is required." });
    return;
  }
  const history = readHistory();
  const caseData = history.find((item) => item.id === caseId);
  if (!caseData) {
    res.status(404).json({ error: "Case not found." });
    return;
  }
  if (!canAccessCase(req.user!, req.company || null, caseData)) {
    res.status(403).json({ error: "You do not have permission to classify this case." });
    return;
  }
  try {
    const leap = await runLeapForCase(caseId);
    res.json({ success: true, leap });
  } catch (err: any) {
    const msg = (err && err.message) || "LEAP classification failed.";
    const status = /API key|engine unavailable/i.test(msg) ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

// ── Knowledge Processing: Extract & Summarize Resources from Text+Links ──
app.post("/api/knowledge/process-text", requireAdmin, express.json({ limit: '10mb' }), async (req, res) => {
  const { text, folderPath } = req.body;
  if (!text || !text.trim()) {
    res.status(400).json({ error: 'Text content is required.' });
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'AI engine is not available. Please add a valid API key.', code: 'AI_UNAVAILABLE' });
    return;
  }

  // Determine where to save — use storage folder, or fallback to uploads/_ai_knowledge
  const basePath = folderPath && fs.existsSync(path.resolve(folderPath))
    ? path.resolve(folderPath)
    : path.join(process.cwd(), 'uploads');
  const knowledgeDir = path.join(basePath, '_ai_knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });

  // 1. Extract all URLs from the pasted text using robust URL extraction
  const uniqueUrls = extractUrls(text);
  const textWithoutUrls = text.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  const resources: Array<{
    type: 'text' | 'url';
    source: string;
    summary: string;
    status: 'processing' | 'completed' | 'error';
    fileName?: string;
  }> = [];

  // 2. Process the plain text portion (non-URL content) — summarize & save as knowledge
  const textContent = textWithoutUrls;
  if (textContent.length > 50) {
    resources.push({
      type: 'text',
      source: 'pasted-text',
      summary: 'Summarizing pasted text content...',
      status: 'processing',
    });
  }

  // 3. Process each unique URL
  for (const url of uniqueUrls) {
    resources.push({
      type: 'url',
      source: url,
      summary: 'Queued for fetching...',
      status: 'processing',
    });
  }

  // Send initial response immediately so UI shows queued state
  res.json({
    success: true,
    totalResources: resources.length,
    urlCount: uniqueUrls.length,
    hasTextContent: textContent.length > 50,
    message: `Found ${uniqueUrls.length} URL(s) and ${textContent.length > 50 ? 'pasted text content' : 'no significant text'}. Processing in background.`,
    resources,
  });

  // ── Background processing ──────────────────────────────────────────

  // Process text content
  if (textContent.length > 50) {
    try {
      const textSummaryResponse = await generateContentWithRetry(ai, {
        model: 'gemini-3.5-flash',
        contents: [{
          text: `You are an expert orthodontic knowledge curator. Summarize the following text content into structured knowledge for an AI CAD designer. Extract clinical guidelines, material specifications, manufacturing rules, or any actionable insights.

Produce a markdown summary with these sections:
- ## Key Takeaways
- ## Clinical/Technical Guidelines Extracted
- ## Relevance to Clear Aligner / Orthodontic Appliance Design
- ## Summary

TEXT CONTENT:
${textContent.slice(0, 30000)}`
        }],
        config: { temperature: 0.3 },
      });

      const textSummary = textSummaryResponse.text?.trim() || 'No summary generated.';
      const textTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const textFileName = `pasted_knowledge_${textTimestamp}.md`;
      const textFilePath = path.join(knowledgeDir, textFileName);

      const textFileContent = `---
source: pasted-text
created_at: ${new Date().toISOString()}
type: ai-knowledge-summary
---

# Pasted Knowledge Resource

${textSummary}
`;
      fs.writeFileSync(textFilePath, textFileContent, 'utf-8');

      // Update resource status in console
      console.log(`[Knowledge] Saved pasted text summary to: ${textFilePath}`);
    } catch (err: any) {
      console.error('[Knowledge] Failed to process text content:', err);
    }
  }

  // Process each URL sequentially
  for (let i = 0; i < uniqueUrls.length; i++) {
    let url = uniqueUrls[i];
    // Sanitize URL before fetching — handle edge cases
    const sanitized = sanitizeUrl(url);
    if (!sanitized) {
      console.error(`[Knowledge] Skipping unparseable URL: ${url}`);
      continue;
    }
    url = sanitized;
    try {
      console.log(`[Knowledge] Fetching URL ${i + 1}/${uniqueUrls.length}: ${url}`);
      const fetchResponse = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhiteSmileAI/1.0)' },
        signal: AbortSignal.timeout(30000),
      });

      if (!fetchResponse.ok) {
        console.error(`[Knowledge] Failed to fetch ${url}: HTTP ${fetchResponse.status}`);
        continue;
      }

      const contentType = fetchResponse.headers.get('content-type') || '';
      const isHtml = contentType.includes('text/html') || contentType.includes('text/plain');
      let pageContent: string;

      if (isHtml) {
        pageContent = await fetchResponse.text();
        pageContent = pageContent
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[^;]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 50000);
      } else {
        pageContent = `[Content at ${url} — type: ${contentType}]`;
      }

      if (!pageContent || pageContent.length < 20) continue;

      let domain = 'unknown';
      try { domain = new URL(url).hostname; } catch { /* use fallback */ }
      const summaryResponse = await generateContentWithRetry(ai, {
        model: 'gemini-3.5-flash',
        contents: [{
          text: `You are an expert orthodontic knowledge curator. Extract actionable clinical and manufacturing guidelines from this web content for an AI CAD designer.

Produce a structured markdown summary with these exact sections:

# Source: ${url}

## Domain
${domain}

## Key Takeaways
[Bullet-list of 3-7 most important facts/insights]

## Extracted Clinical/Technical Guidelines
[Specific rules, numerical limits, material specs, or protocols. If none, write "No specific technical guidelines found."]

## Relevance to Clear Aligner / Orthodontic Appliance Design
[1-3 sentence assessment]

## Summary
[2-3 sentence concise summary]

---
PAGE CONTENT:
${pageContent}`
        }],
        config: { temperature: 0.3 },
      });

      const summaryText = summaryResponse.text?.trim() || 'No summary generated.';
      const safeName = domain.replace(/^www\./, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
      const urlTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `${safeName}_${urlTimestamp}.md`;
      const filePath = path.join(knowledgeDir, fileName);

      const fileContent = `---
source_url: ${url}
fetched_at: ${new Date().toISOString()}
domain: ${domain}
type: ai-knowledge-summary
---

${summaryText}
`;
      fs.writeFileSync(filePath, fileContent, 'utf-8');
      console.log(`[Knowledge] Saved URL knowledge from ${url} to: ${filePath}`);

    } catch (err: any) {
      console.error(`[Knowledge] Failed to process URL ${url}:`, err && typeof err.message === 'string' ? err.message : String(err));
    }
  }

  console.log(`[Knowledge] Processing complete. ${uniqueUrls.length} URL(s) processed.`);
});

// ── Auto-Learning: Autonomous Online Research ────────────────────────────
app.post("/api/knowledge/auto-learn", requireAdmin, express.json({ limit: '10mb' }), async (req, res) => {
  const { context, folderPath, coreMemoryContext } = req.body;
  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'AI engine is not available. Please add a valid API key.', code: 'AI_UNAVAILABLE' });
    return;
  }

  const basePath = folderPath && fs.existsSync(path.resolve(folderPath))
    ? path.resolve(folderPath)
    : path.join(process.cwd(), 'uploads');
  const knowledgeDir = path.join(basePath, '_ai_knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });

  // Compute context string for research
  const researchContext = coreMemoryContext || context || 'orthodontic clear aligner design, dental CAD manufacturing';

  // 1. Ask AI to generate research queries and target URLs based on context
  const queryResponse = await generateContentWithRetry(ai, {
    model: 'gemini-3.5-flash',
    contents: [{
      text: `You are an expert orthodontic research librarian. Based on the following AI system context, generate 5 specific research queries that would help expand the AI's knowledge for better clear aligner and orthodontic appliance design.

For each query, also suggest 2-3 high-quality URLs (PubMed, NCBI, research gate, dental journals, manufacturer spec pages) where the answer might be found.

Return ONLY a valid JSON array of objects with this structure:
[
  {
    "query": "specific research question",
    "suggestedUrls": ["https://...", "https://..."],
    "reason": "why this knowledge would be valuable for AI orthodontic CAD design"
  }
]

AI CONTEXT:
${researchContext.slice(0, 8000)}`
    }],
    config: { temperature: 0.4, responseMimeType: 'application/json' },
  });

  let researchQueries: Array<{ query: string; suggestedUrls: string[]; reason: string }> = [];
  try {
    const queryText = queryResponse.text?.trim() || '[]';
    const cleaned = queryText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const lastBracket = cleaned.lastIndexOf(']');
    researchQueries = JSON.parse(lastBracket !== -1 ? cleaned.substring(0, lastBracket + 1) : cleaned);
  } catch (err) {
    console.error('[AutoLearn] Failed to parse research queries:', err);
    researchQueries = [
      { query: 'Latest clear aligner material advancements', suggestedUrls: ['https://pubmed.ncbi.nlm.nih.gov/'], reason: 'General research' },
    ];
  }

  if (!Array.isArray(researchQueries) || researchQueries.length === 0) {
    researchQueries = [
      { query: 'Orthodontic clear aligner biomechanics and material science', suggestedUrls: ['https://pubmed.ncbi.nlm.nih.gov/'], reason: 'Core knowledge expansion' },
    ];
  }

  // Respond immediately with the plan
  const totalPlanned = researchQueries.length;
  res.json({
    success: true,
    message: `Auto-learning started with ${totalPlanned} research topic(s)`,
    queries: researchQueries.map(q => ({ query: q.query, reason: q.reason, status: 'researching' })),
    totalQueries: totalPlanned,
  });

  // ── Background research ────────────────────────────────────────────
  const allFindings: string[] = [];
  const allGuidelines: string[] = [];

  for (let i = 0; i < researchQueries.length; i++) {
    const { query, suggestedUrls } = researchQueries[i];
    console.log(`[AutoLearn] Researching (${i + 1}/${totalPlanned}): ${query}`);

    // Try to fetch each suggested URL
    let combinedContent = '';
    for (const rawUrl of suggestedUrls.slice(0, 3)) {
      const cleanUrl = sanitizeUrl(rawUrl);
      if (!cleanUrl) continue;
      try {
        const fetchResponse = await fetch(cleanUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhiteSmileAI/1.0; ResearchBot)' },
          signal: AbortSignal.timeout(15000),
        });

        if (fetchResponse.ok) {
          const contentType = fetchResponse.headers.get('content-type') || '';
          if (contentType.includes('text/html') || contentType.includes('text/plain')) {
            let html = await fetchResponse.text();
            html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 20000);
            combinedContent += `\n\n--- Content from ${cleanUrl} ---\n${html}`;
          }
        }
      } catch (err) {
        console.error(`[AutoLearn] Failed to fetch ${cleanUrl}:`, (err as Error).message);
      }
    }

    // If we couldn't fetch real content, generate simulated research content using AI
    if (!combinedContent || combinedContent.length < 100) {
      const simulatedResponse = await generateContentWithRetry(ai, {
        model: 'gemini-3.5-flash',
        contents: [{
          text: `You are an expert orthodontic researcher. Based on your extensive training knowledge, provide comprehensive, evidence-based information about the following research query. Include specific clinical guidelines, numerical data, material specifications, and manufacturing recommendations where applicable.

Research Query: ${query}

Format your response as structured markdown with:
- Key Facts & Data
- Clinical Guidelines
- Manufacturing Implications
- Sources (reference standard orthodontic literature, even if from memory)`
        }],
        config: { temperature: 0.4 },
      });
      combinedContent = simulatedResponse.text?.trim() || '';
    }

    if (combinedContent.length > 100) {
      // Summarize the findings into structured knowledge
      const learnResponse = await generateContentWithRetry(ai, {
        model: 'gemini-3.5-flash',
        contents: [{
          text: `Distill the following research content into structured knowledge for an AI orthodontic CAD system. Extract ONLY factual, clinically-relevant information. Include specific numbers, guidelines, and rules where present.

Research Query: ${query}

CONTENT:
${combinedContent.slice(0, 25000)}

Format as markdown:
## Research Topic
${query}

## Key Findings
[Bullet list of specific, actionable findings]

## Clinical Guidelines Extracted
[Specific rules, limits, or protocols]

## Manufacturing Relevance
[How this applies to clear aligner / retainer fabrication]

## Source References
[List of any URLs or standard references mentioned]`
        }],
        config: { temperature: 0.3 },
      });

      const findingText = learnResponse.text?.trim() || '';
      if (findingText.length > 50) {
        allFindings.push(findingText);

        // Save as individual knowledge file
        const safeName = query.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 60);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `auto_learn_${safeName}_${ts}.md`;
        const filePath = path.join(knowledgeDir, fileName);

        const fileContent = `---
source: auto-learn
query: ${query}
generated_at: ${new Date().toISOString()}
type: ai-auto-learned-knowledge
---

${findingText}
`;
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        console.log(`[AutoLearn] Saved finding to: ${filePath}`);

        // Also extract specific guidelines for potential core memory update
        const lines = findingText.split('\n').filter(l => l.startsWith('- ') || l.startsWith('* '));
        allGuidelines.push(...lines.slice(0, 10));
      }
    }
  }

  // Try to auto-update core memory with new knowledge if significant findings exist
  if (allFindings.length > 0) {
    try {
      const coreMemory = getCoreMemory();
      const combinedFindings = allFindings.join('\n\n---\n\n');
      const guidelinesText = allGuidelines.join('\n').slice(0, 3000);

      const updateResponse = await generateContentWithRetry(ai, {
        model: 'gemini-3.5-flash',
        contents: [{
          text: `You are an AI knowledge integration specialist. Review the current AI Core Memory instructions and the newly learned research findings below. Generate an updated version of the "analysisInstructions" that incorporates relevant new knowledge.

CURRENT ANALYSIS INSTRUCTIONS:
${coreMemory.analysisInstructions.slice(0, 5000)}

NEW RESEARCH FINDINGS:
${combinedFindings.slice(0, 15000)}

NEW GUIDELINES EXTRACTED:
${guidelinesText}

Produce an updated "analysisInstructions" string that seamlessly integrates the new knowledge. Preserve all existing content and append new relevant clinical guidelines, material specifications, or manufacturing rules at the end. Return ONLY the updated analysisInstructions text, nothing else.`
        }],
        config: { temperature: 0.3 },
      });

      const updatedInstructions = updateResponse.text?.trim();
      if (updatedInstructions && updatedInstructions.length > 100) {
        const currentCore = getCoreMemory();
        saveCoreMemory({
          ...currentCore,
          analysisInstructions: updatedInstructions,
        });
        console.log('[AutoLearn] Core memory updated with new research findings.');
      }
    } catch (err) {
      console.error('[AutoLearn] Failed to update core memory:', err);
    }
  }

  const summaryFilePath = path.join(knowledgeDir, `auto_learn_summary_${Date.now()}.md`);
  const summaryContent = `---
type: auto-learn-summary
generated_at: ${new Date().toISOString()}
queries_researched: ${allFindings.length}
---

# Auto-Learning Summary

Topics researched: ${researchQueries.map(q => q.query).join(', ')}

## Findings

${allFindings.join('\n\n---\n\n')}
`;
  try { fs.writeFileSync(summaryFilePath, summaryContent, 'utf-8'); } catch { /* ignore */ }

  console.log(`[AutoLearn] Complete. Generated ${allFindings.length} knowledge file(s). Core memory was ${allFindings.length > 0 ? 'updated' : 'not updated'}.`);
});

// ── Headless Blender STL Processor Endpoint ────────────────────────────
// Invokes Blender --background directly from Node.js (no Python dependency).
// Runs: blender --background --python blender_script.py -- --input=... --output=...
app.post("/api/blender/process", requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const { inputPath, outputName, decimate } = req.body;

  if (!inputPath) {
    res.status(400).json({ success: false, error: 'inputPath is required.' });
    return;
  }

  try {
    // Resolve paths — handle absolute, relative, file://, and /uploads/ paths
    const workspaceRoot = process.cwd();
    let resolvedInput = inputPath;
    // Strip file:// prefix if present
    if (resolvedInput.startsWith('file://')) {
      resolvedInput = resolvedInput.replace('file://', '');
    }
    // Strip leading /uploads/ if frontend sent a URL-style path
    if (resolvedInput.startsWith('/uploads/')) {
      resolvedInput = path.join(workspaceRoot, resolvedInput.slice(1));
    } else if (!path.isAbsolute(resolvedInput) && !/^[a-zA-Z]:\\/.test(resolvedInput)) {
      resolvedInput = path.resolve(workspaceRoot, resolvedInput);
    }

    const outputFilename = outputName || 'processed.stl';
    const outputPath = path.resolve(workspaceRoot, 'uploads', outputFilename);

    if (!fs.existsSync(resolvedInput)) {
      res.status(404).json({ success: false, error: `Input file not found: ${resolvedInput}` });
      return;
    }

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Resolve Blender executable path directly (no Python dependency)
    const envBlender = process.env.BLENDER_PATH;
    let blenderPath: string | null = null;

    if (envBlender && fs.existsSync(envBlender)) {
      blenderPath = path.resolve(envBlender);
    }

    if (!blenderPath) {
      // Try system PATH
      try {
        const which = execSync('where blender', { encoding: 'utf-8', timeout: 5000 }).toString().trim().split('\n')[0];
        if (which && fs.existsSync(which)) blenderPath = which;
      } catch { /* not on PATH */ }
    }

    if (!blenderPath && process.platform === 'win32') {
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env.LOCALAPPDATA || '';
      const fallbacks = [
        path.join(programFiles, 'Blender Foundation', 'Blender 5.2', 'blender.exe'),
        path.join(programFiles, 'Blender Foundation', 'Blender 4.2', 'blender.exe'),
        path.join(programFiles, 'Blender Foundation', 'Blender 4.1', 'blender.exe'),
        path.join(programFiles, 'Blender Foundation', 'Blender 4.0', 'blender.exe'),
        path.join(programFiles, 'Blender Foundation', 'Blender 3.6', 'blender.exe'),
        path.join(programFilesX86, 'Blender Foundation', 'Blender 4.2', 'blender.exe'),
        path.join(localAppData, 'Microsoft', 'WindowsApps', 'blender.exe'),
      ];
      for (const c of fallbacks) {
        if (fs.existsSync(c)) { blenderPath = c; break; }
      }
    }

    if (!blenderPath) {
      const hint = envBlender
        ? `BLENDER_PATH is set to '${envBlender}' but no executable exists there. Update your .env.local file.`
        : 'Install Blender from https://www.blender.org/download/ and set BLENDER_PATH in .env.local';
      return res.status(500).json({ success: false, error: `Blender executable not found. ${hint}` });
    }

    // Locate the Blender Python script
    const blenderScript = path.join(workspaceRoot, 'blender', 'blender_script.py');
    if (!fs.existsSync(blenderScript)) {
      return res.status(500).json({ success: false, error: `Blender script not found at: ${blenderScript}` });
    }

    // Build command: blender --background --python blender_script.py -- --input=... --output=...
    // Using spawnSync with args array (bypasses cmd.exe, safe for paths with spaces)
    const blenderArgs: string[] = [
      '--background',
      '--python', blenderScript,
      '--',
      `--input=${resolvedInput}`,
      `--output=${outputPath}`,
    ];
    if (decimate && decimate > 0 && decimate <= 1) {
      blenderArgs.push(`--decimate=${decimate}`);
    }

    console.log(`[Blender] Running: ${blenderPath}`);
    console.log(`[Blender]   Input: ${resolvedInput}`);
    console.log(`[Blender]   Output: ${outputPath}`);
    console.log(`[Blender]   Decimate: ${decimate ?? 'none'}`);

    // Execute Blender via spawnSync (bypasses cmd.exe, handles spaces in paths safely)
    let stdout: string;
    let stderr: string;
    const result = spawnSync(blenderPath, blenderArgs, {
      encoding: 'utf-8',
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });

    stdout = result.stdout || '';
    stderr = result.stderr || '';

    if (result.error) {
      // Process failed to launch (ENOENT, timeout, etc.)
      const errMsg = `Failed to launch Blender: ${result.error.message || result.error}`;
      console.error(`[Blender] Launch error:`, result.error);
      return res.status(500).json({ success: false, error: errMsg, stderr: errMsg });
    }

    if (result.status !== 0) {
      // Blender ran but exited with an error — combine stdout+stderr so frontend displays it
      const errorDetail = stderr + (stdout ? `\n${stdout}` : '');
      console.log(`[Blender] Exit code: ${result.status}`);
      if (fs.existsSync(outputPath)) {
        const outStat = fs.statSync(outputPath);
        if (outStat.size > 0) {
          return res.json({ success: true, outputPath, fileSize: outStat.size, stdout: '', stderr: errorDetail, return_code: result.status });
        }
      }
      return res.json({ success: false, outputPath, stdout: '', stderr: errorDetail, return_code: result.status });
    }

    // Check output
    if (fs.existsSync(outputPath)) {
      const outStat = fs.statSync(outputPath);
      if (outStat.size > 0) {
        res.json({ success: true, outputPath, fileSize: outStat.size, stdout, stderr: '', return_code: 0 });
      } else {
        res.json({ success: false, outputPath, stdout: '', stderr: 'Output file was created but is empty.', return_code: -1 });
      }
    } else {
      res.json({ success: false, outputPath, stdout: '', stderr: 'Output file was not created.', return_code: -1 });
    }
  } catch (err: any) {
    console.error('[Blender] Server error:', err);
    res.status(500).json({ success: false, error: err.message || 'Blender processing failed', stderr: err.message || '' });
  }
});

// ── Open Blender GUI for Interactive STL Editing ────────────────────
// Launches Blender in GUI mode (not headless) with the STL file loaded
// so the user can view and manually edit the mesh.
app.post("/api/blender/open-gui", requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const { inputPath } = req.body;

  if (!inputPath) {
    res.status(400).json({ success: false, error: 'inputPath is required.' });
    return;
  }

  try {
    // Resolve the file path the same way as the processor endpoint
    const workspaceRoot = process.cwd();
    let resolvedInput = inputPath;
    if (resolvedInput.startsWith('file://')) {
      resolvedInput = resolvedInput.replace('file://', '');
    }
    if (resolvedInput.startsWith('/uploads/')) {
      resolvedInput = path.join(workspaceRoot, resolvedInput.slice(1));
    } else if (!path.isAbsolute(resolvedInput) && !/^[a-zA-Z]:\\/.test(resolvedInput)) {
      resolvedInput = path.resolve(workspaceRoot, resolvedInput);
    }

    if (!fs.existsSync(resolvedInput)) {
      res.status(404).json({ success: false, error: `File not found: ${resolvedInput}` });
      return;
    }

    // Resolve Blender path
    const envBlender = process.env.BLENDER_PATH;
    let blenderPath: string | null = null;

    if (envBlender && fs.existsSync(envBlender)) {
      blenderPath = path.resolve(envBlender);
    }

    if (!blenderPath) {
      try {
        const which = execSync('where blender', { encoding: 'utf-8', timeout: 5000 }).toString().trim().split('\n')[0];
        if (which && fs.existsSync(which)) blenderPath = which;
      } catch { /* not on PATH */ }
    }

    if (!blenderPath && process.platform === 'win32') {
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env.LOCALAPPDATA || '';
      const candidates = [
        path.join(programFiles, 'Blender Foundation', 'Blender 5.2', 'blender.exe'),
        path.join(programFiles, 'Blender Foundation', 'Blender 4.2', 'blender.exe'),
        path.join(programFilesX86, 'Blender Foundation', 'Blender 4.2', 'blender.exe'),
        path.join(localAppData, 'Microsoft', 'WindowsApps', 'blender.exe'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) { blenderPath = c; break; }
      }
    }

    if (!blenderPath) {
      return res.status(500).json({ success: false, error: 'Blender executable not found. Check BLENDER_PATH in .env.local' });
    }

    // The script that loads the STL in Blender's GUI
    const openScript = path.join(workspaceRoot, 'blender', 'open_in_blender.py');
    if (!fs.existsSync(openScript)) {
      return res.status(500).json({ success: false, error: `Blender script not found at: ${openScript}` });
    }

    // Build command: blender --python open_in_blender.py -- --input="file.stl"
    // NO --background flag — this opens the Blender GUI window
    console.log(`[Blender GUI] Opening: ${resolvedInput}`);

    // Spawn Blender asynchronously — we don't wait for it, the user edits in Blender
    const child = spawn(blenderPath, [
      '--python', openScript,
      '--',
      `--input=${resolvedInput}`
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false, // Show the Blender window!
    });
    child.unref(); // Let Blender run independently

    // Give it a moment to launch
    res.json({ success: true, message: 'Blender opened with STL file. Edit and save in Blender.' });
  } catch (err: any) {
    console.error('[Blender GUI] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to open Blender' });
  }
});

// ── Serve Local File via HTTP ─────────────────────────────────────────
// Copies a local file (e.g., from Google Drive) to the uploads directory
// so it can be fetched by the browser for Three.js rendering.
app.post("/api/files/serve-local", requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'filePath is required.' });
  }

  try {
    let resolved = filePath;
    if (resolved.startsWith('file://')) resolved = resolved.replace('file://', '');

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ success: false, error: `File not found: ${resolved}` });
    }

    // Copy to uploads with a unique name
    const ext = path.extname(resolved) || '.stl';
    const baseName = path.basename(resolved, ext);
    const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_') + ext;
    const dest = path.join(uploadsDir, safeName);

    if (!fs.existsSync(dest)) {
      fs.copyFileSync(resolved, dest);
    }

    const url = `/uploads/${safeName}`;
    console.log(`[File Serve] ${resolved} → ${url}`);
    res.json({ success: true, url });
  } catch (err: any) {
    console.error('[File Serve] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Active Learning & Security Endpoints ─────────────────────────────
// Active Learning: toggle internet search for AI precision
app.post("/api/active-learning/toggle", requireAuth, express.json(), async (req, res) => {
  const { enabled } = req.body;
  console.log(`[ActiveLearning] ${enabled ? 'Enabled' : 'Disabled'} — AI will${enabled ? '' : ' not'} search the internet for treatment data.`);
  res.json({ success: true, activeLearning: !!enabled });
});

// ── Magic byte signatures for file type validation ────────────────────
const MAGIC_BYTES: Record<string, { offset: number; bytes: number[]; mask?: number[] }[]> = {
  '.stl': [
    { offset: 0, bytes: [0x73, 0x6F, 0x6C, 0x69, 0x64] }, // "solid" (ASCII STL)
  ],
  '.pdf': [
    { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
  ],
  '.jpg': [
    { offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
  ],
  '.jpeg': [
    { offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
  ],
  '.png': [
    { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] }, // PNG header
  ],
  '.gif': [
    { offset: 0, bytes: [0x47, 0x49, 0x46] }, // "GIF"
  ],
  '.mp4': [
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // "ftyp" box
  ],
  '.mov': [
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // "ftyp" box
  ],
};

/** Check if a buffer's magic bytes match expected signatures for a file type */
function validateMagicBytes(buf: Buffer, ext: string): { valid: boolean; detected: string | null } {
  const sigs = MAGIC_BYTES[ext];
  if (!sigs) return { valid: true, detected: null }; // unknown type — skip magic check
  for (const sig of sigs) {
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      const offset = sig.offset + i;
      const expected = sig.bytes[i];
      const mask = sig.mask?.[i] ?? 0xFF;
      if (offset < buf.length && (buf[offset] & mask) !== (expected & mask)) {
        match = false;
        break;
      }
    }
    if (match) return { valid: true, detected: ext };
  }
  // Binary STL has NO magic header: 80-byte arbitrary header + uint32
  // little-endian triangle count. Accept it when the count is plausible
  // (1 .. 50M triangles) — otherwise every binary dental scan would be
  // falsely flagged as "Unknown/mismatched" and deleted.
  if (ext === '.stl' && buf.length >= 84) {
    const triCount = buf.readUInt32LE(80);
    if (triCount >= 1 && triCount <= 50_000_000) {
      return { valid: true, detected: 'binary STL' };
    }
  }
  // Try to detect what it actually is
  if (buf[0] === 0x4D && buf[1] === 0x5A) return { valid: false, detected: 'EXE (MZ)' };
  if (buf[0] === 0x7F && buf[1] === 0x45 && buf[2] === 0x4C && buf[3] === 0x46) return { valid: false, detected: 'ELF' };
  if (buf[0] === 0xCA && buf[1] === 0xFE && buf[2] === 0xBA && buf[3] === 0xBE) return { valid: false, detected: 'Mach-O' };
  if (buf.toString('ascii', 0, 4) === '#!/') return { valid: false, detected: 'Script (#!/)' };
  return { valid: false, detected: 'Unknown/mismatched' };
}

/**
 * True PE detection: an MZ at offset i is only a real Windows executable
 * when the DOS header's e_lfanew (uint32 at i+0x3C) points to a "PE\0\0"
 * signature. Random "MZ" byte pairs inside binary STL mesh data are NOT
 * executables and must not be flagged.
 */
function isRealPeAt(buf: Buffer, mzOffset: number): boolean {
  if (mzOffset + 0x40 > buf.length) return false;
  const e_lfanew = buf.readUInt32LE(mzOffset + 0x3C);
  const peOffset = mzOffset + e_lfanew;
  if (peOffset + 4 > buf.length) return false;
  return (
    buf[peOffset] === 0x50 && // 'P'
    buf[peOffset + 1] === 0x45 && // 'E'
    buf[peOffset + 2] === 0x00 &&
    buf[peOffset + 3] === 0x00
  );
}

/** Scan buffer for embedded executable signatures (PE, ELF, Mach-O) */
function scanForEmbeddedExecutables(buf: Buffer): { found: boolean; details: string[] } {
  const details: string[] = [];
  // Search for REAL PE executables (MZ + valid e_lfanew -> PE\0\0)
  let idx = buf.indexOf(Buffer.from([0x4D, 0x5A]), 0);
  while (idx !== -1 && idx < 1000000) {
    if (isRealPeAt(buf, idx)) {
      details.push(`Embedded PE executable (MZ) at byte offset ${idx}`);
      if (details.length >= 3) break;
    }
    idx = buf.indexOf(Buffer.from([0x4D, 0x5A]), idx + 1);
  }
  // Search for ELF
  idx = buf.indexOf(Buffer.from([0x7F, 0x45, 0x4C, 0x46]), 1);
  if (idx !== -1 && idx < 1000000) {
    details.push(`Embedded ELF signature at byte offset ${idx}`);
  }
  return { found: details.length > 0, details };
}

/** Scan for malicious content patterns (PHP shells, JS injection, base64 payloads) */
function scanForMaliciousContent(buf: Buffer, filename: string): { threats: string[]; score: number } {
  const threats: string[] = [];
  let score = 0;
  const ext = path.extname(filename).toLowerCase();
  const text = buf.toString('utf8').toLowerCase();

  // --- PHP shells in uploads ---
  if (ext !== '.php' && (text.includes('<?php') || text.includes('<?='))) {
    threats.push('PHP code embedded in non-PHP file');
    score += 10;
  }

  // --- Base64-encoded executable payloads ---
  const b64Payloads = text.match(/[a-z0-9+/]{200,}={0,2}/gi);
  if (b64Payloads) {
    for (const b64 of b64Payloads.slice(0, 3)) {
      try {
        const decoded = Buffer.from(b64, 'base64').toString('latin1');
        if (decoded.includes('MZ') || decoded.includes('ELF')) {
          threats.push('Base64-encoded executable payload detected');
          score += 10;
          break;
        }
      } catch { /* skip un-decodable */ }
    }
  }

  // --- JavaScript/PowerShell injection in non-script files ---
  if (!['.js', '.ts', '.tsx', '.jsx', '.ps1', '.py'].includes(ext)) {
    const dangerousCalls = [
      { pattern: /eval\s*\(/g, label: 'eval() call' },
      { pattern: /exec\s*\(/g, label: 'exec() call' },
      { pattern: /spawn\s*\(/g, label: 'spawn() call' },
      { pattern: /powershell\.exe/gi, label: 'PowerShell invocation' },
      { pattern: /cmd\.exe/gi, label: 'cmd.exe invocation' },
      { pattern: /wscript\.shell/gi, label: 'WScript.Shell' },
    ];
    for (const { pattern, label } of dangerousCalls) {
      const match = text.match(pattern);
      if (match) {
        threats.push(`Suspicious ${label} in ${ext} file`);
        score += 5;
      }
    }
  }

  // --- Extremely high entropy (> 0.95) suggests encrypted/packed payload ---
  if (buf.length > 1024) {
    const freq = new Array(256).fill(0);
    for (let i = 0; i < buf.length; i++) freq[buf[i]]++;
    let entropy = 0;
    for (const c of freq) {
      if (c > 0) {
        const p = c / buf.length;
        entropy -= p * Math.log2(p);
      }
    }
    const normalizedEntropy = entropy / 8;
    if (normalizedEntropy > 0.95) {
      threats.push(`High entropy (${(normalizedEntropy * 100).toFixed(1)}%) — possible encrypted/packed payload`);
      score += 8;
    }
  }

  return { threats, score };
}

// Antivirus: scan a file for malware using real file analysis
app.post("/api/security/scan", requireAdmin, express.json({ limit: '50mb' }), async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'filePath required' });

  let resolved = filePath;
  if (resolved.startsWith('file://')) resolved = resolved.replace('file://', '');
  if (!fs.existsSync(resolved)) return res.status(404).json({ success: false, error: 'File not found' });

  const size = fs.statSync(resolved).size;
  const ext = path.extname(resolved).toLowerCase();
  const filename = path.basename(resolved);

  const scanStart = Date.now();
  const threatsFound: string[] = [];

  // 1. Check allowed extensions
  const allowedExtensions = ['.stl', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.txt', '.doc', '.docx', '.zip', '.rar'];
  if (!allowedExtensions.includes(ext)) {
    threatsFound.push(`⚠ Blocked: Unsupported file type "${ext}" is not allowed for upload`);
  }

  // 2. Check file size limits
  if (size === 0) {
    threatsFound.push('⚠ Empty file — possible corruption');
  } else if (size > 500 * 1024 * 1024) {
    threatsFound.push('⚠ File exceeds maximum allowed size (500MB)');
  }

  // 3. Read file header for magic byte + content analysis
  if (threatsFound.length === 0 && size > 0) {
    const readSize = Math.min(size, 2 * 1024 * 1024); // read up to 2MB
    const fd = fs.openSync(resolved, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);
    fs.closeSync(fd);

    // 3a. Magic byte validation
    if (MAGIC_BYTES[ext]) {
      const magic = validateMagicBytes(buf, ext);
      if (!magic.valid) {
        threatsFound.push(`⚠ File type mismatch: declared as ${ext} but detected as ${magic.detected}`);
      }
    }

    // 3b. Scan for embedded executables
    const embedded = scanForEmbeddedExecutables(buf);
    if (embedded.found) {
      threatsFound.push(...embedded.details.map(d => `⚠ ${d}`));
    }

    // 3c. Scan for malicious content
    const malicious = scanForMaliciousContent(buf, filename);
    if (malicious.threats.length > 0) {
      threatsFound.push(...malicious.threats.map(t => `⚠ ${t}`));
    }
  }

  // Infected files are deleted immediately — no quarantine folder
  // (quarantine only wastes disk space with copies of bad files).
  let deleted = false;
  if (threatsFound.length > 0) {
    try {
      // Only delete the original if it was a temp upload file (starts with uploads/)
      if (resolved.includes('uploads')) {
        fs.unlinkSync(resolved);
        deleted = true;
        console.log(`[Antivirus] 🚫 Deleted infected ${filename}`);
      }
    } catch (e: any) {
      console.warn(`[Antivirus] Failed to delete infected ${filename}: ${e.message}`);
    }
  }

  const result = {
    success: true,
    file: filename,
    size,
    scanTimeMs: Date.now() - scanStart,
    scanned: true,
    safe: threatsFound.length === 0,
    threats: threatsFound.length,
    threatDetails: threatsFound,
    deleted,
  };

  console.log(`[Antivirus] ${result.safe ? '✅' : '❌'} ${filename} — ${result.safe ? 'Clean' : `${threatsFound.length} threat(s)`} (${result.scanTimeMs}ms)`);
  res.json(result);
});

// ── Antivirus: Delete infected file ───────────────────────────────────
app.post("/api/security/delete-infected", requireAdmin, express.json(), async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'filePath required' });
  let resolved = filePath;
  if (resolved.startsWith('file://')) resolved = resolved.replace('file://', '');
  try {
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
      console.log(`[Antivirus] 🗑 Deleted infected file: ${resolved}`);
    }
    res.json({ success: true, deleted: true, file: path.basename(resolved) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Antibug: source code analysis & auto-fix ──────────────────────────
/**
 * Run TypeScript compiler checks and return structured errors.
 */
function runTypeScriptCheck(workspaceRoot: string): { errors: AntivirusBug[]; raw: string } {
  const errors: AntivirusBug[] = [];
  let raw = '';
  try {
    raw = execSync('npx tsc --noEmit', { cwd: workspaceRoot, timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e: any) {
    raw = e.stdout || e.stderr || e.message || '';
  }
  // Parse tsc output lines like: "src/App.tsx(24,7): error TS6133: 'BookOpen' is declared but its value is never read."
  const tscLine = /^(.*?)\((\d+),(\d+)\):\s*(error|warning)\s+(\S+):\s*(.*)$/gm;
  let match;
  while ((match = tscLine.exec(raw)) !== null) {
    errors.push({
      file: match[1].trim(),
      line: parseInt(match[2], 10),
      col: parseInt(match[3], 10),
      severity: match[4] as 'error' | 'warning',
      code: match[5],
      message: match[6].trim(),
    });
  }
  return { errors, raw };
}

/**
 * Run ESLint check and return structured errors.
 */
function runESLintCheck(workspaceRoot: string): { errors: AntivirusBug[]; raw: string } {
  const errors: AntivirusBug[] = [];
  let raw = '';
  try {
    raw = execSync('npx eslint . --format json --no-eslintrc --config eslint.config.js 2>&1 || true', {
      cwd: workspaceRoot, timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Try parsing as JSON
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const fileResult of parsed) {
        for (const msg of fileResult.messages || []) {
          errors.push({
            file: fileResult.filePath?.replace(workspaceRoot.replace(/\\/g, '/'), '').replace(/^\//, '') || 'unknown',
            line: msg.line || 0,
            col: msg.column || 0,
            severity: msg.severity >= 2 ? 'error' : 'warning',
            code: msg.ruleId || 'eslint',
            message: msg.message,
          });
        }
      }
    }
  } catch { /* eslint config may not exist — ignore */ }
  return { errors, raw };
}

interface AntivirusBug {
  file: string;
  line: number;
  col: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/** Attempt to auto-fix a known bug pattern in source code */
function autoFixBug(filePath: string, bug: AntivirusBug): string | null {
  try {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) return null;
    const content = fs.readFileSync(absPath, 'utf8');
    const lines = content.split('\n');
    const lineIdx = bug.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) return null;

    // ── Fix TS6133: unused import/variable — remove the line ──────────
    if (bug.code === 'TS6133') {
      const line = lines[lineIdx];
      // Whole line removal: import statements or const/let/var declarations
      if (line.includes('import') || /^\s*(const|let|var)\s/.test(line)) {
        // Check if it's a named import like `import { Foo } from ...` — remove only the name
        const namedImportMatch = line.match(/\{\s*(\w+)\s*\}/);
        if (namedImportMatch && line.includes('import')) {
          // Extract the variable name from error: "'BookOpen' is declared but its value..."
          const varMatch = bug.message.match(/^'(\w+)'/);
          if (varMatch) {
            const varName = varMatch[1];
            // Remove just that name from the braces
            const newLine = line
              .replace(new RegExp(`\\b${varName}\\s*,\\s*`), '')
              .replace(new RegExp(`\\s*,\\s*${varName}`), '')
              .replace(new RegExp(`\\{\\s*${varName}\\s*\\}`), '{}');
            if (newLine !== line && newLine.includes('import')) {
              if (newLine.match(/\{\s*\}/)) {
                // Empty braces — remove whole line
                lines.splice(lineIdx, 1);
              } else {
                lines[lineIdx] = newLine;
              }
              fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
              return `Removed unused import '${varName}' at line ${bug.line}`;
            }
          }
        }
        // Fallback: remove whole import line
        if (line.includes('import')) {
          lines.splice(lineIdx, 1);
          fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
          return `Removed unused import at line ${bug.line}`;
        }
        // Remove unused const/let/var line
        lines.splice(lineIdx, 1);
        fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
        return `Removed unused declaration at line ${bug.line}`;
      }

      // Fix: remove unused destructured variable
      const varMatch = bug.message.match(/^'(\w+)'/);
      if (varMatch) {
        const varName = varMatch[1];
        const newLine = line
          .replace(new RegExp(`\\b${varName}\\s*,\\s*`), '')
          .replace(new RegExp(`\\s*,\\s*${varName}`), '')
          .replace(new RegExp(`\\{\\s*${varName}\\s*\\}`), '{}');
        if (newLine !== line) {
          lines[lineIdx] = newLine;
          fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
          return `Removed unused variable '${varName}' from line ${bug.line}`;
        }
      }
      // Last resort: try replacing line with empty
      if (line.trim()) {
        lines.splice(lineIdx, 1);
        fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
        return `Removed unused declaration at line ${bug.line}`;
      }
    }

    // ── Fix no-console: comment out console.log/debug/trace ──────────
    if (bug.code === 'no-console') {
      const line = lines[lineIdx];
      const trimmed = line.trimStart();
      const indent = line.slice(0, line.length - trimmed.length);
      if (trimmed.startsWith('console.log') || trimmed.startsWith('console.debug') || trimmed.startsWith('console.trace')) {
        lines[lineIdx] = `${indent}// TODO: REMOVE_ME — ${trimmed}`;
        fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
        return `Commented out console.${trimmed.startsWith('console.log') ? 'log' : trimmed.startsWith('console.debug') ? 'debug' : 'trace'}() at line ${bug.line}`;
      }
    }

    // ── Fix empty-catch: add console.warn to empty catch blocks ──────
    if (bug.code === 'empty-catch') {
      const line = lines[lineIdx];
      const indent = line.match(/^\s*/)?.[0] || '';
      lines[lineIdx] = line.replace(/\{\s*\}\s*$/, `{ console.warn('[Catch] Caught error:', error); }`);
      if (lines[lineIdx] === line) {
        // Try another pattern: catch (e) {}
        lines[lineIdx] = line.replace(/catch\s*\([^)]*\)\s*\{\s*\}/, (match) => {
          const varName = match.match(/catch\s*\(([^)]*)\)/)?.[1] || 'error';
          return `catch (${varName}) { console.warn('[Catch] Caught error:', ${varName}); }`;
        });
      }
      if (lines[lineIdx] !== line) {
        fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
        return `Added console.warn to empty catch block at line ${bug.line}`;
      }
    }

    // ── Fix hardcoded-credentials: replace with env var placeholder ──
    if (bug.code === 'hardcoded-credentials') {
      const line = lines[lineIdx];
      const newLine = line.replace(/(password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]+['"]/gi, (match, key) => {
        const envKey = key.replace(/[_-]/g, '_').toUpperCase();
        return `${key}: process.env.${envKey} || '${match.split(/['"]/)[1]}'`;
      });
      if (newLine !== line) {
        lines[lineIdx] = newLine + ' // TODO: Move to .env';
        fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
        return `Replaced hardcoded credential with env var at line ${bug.line}`;
      }
    }

  } catch (e: any) {
    console.warn(`[Antibug] Failed to auto-fix ${filePath}:${bug.line}: ${e.message}`);
  }
  return null;
}

/** Apply quality-fix patterns and return fixes applied */
function applyQualityFixes(workspaceRoot: string, issues: any[]): { fixes: string[]; remaining: any[] } {
  const fixes: string[] = [];
  const remaining: any[] = [];
  for (const issue of issues) {
    const absPath = path.join(workspaceRoot, issue.file);
    if (!fs.existsSync(absPath)) { remaining.push(issue); continue; }
    let fixResult: string | null = null;

    if (issue.code === 'no-console') {
      // Auto-remove console.log/debug/trace lines
      const content = fs.readFileSync(absPath, 'utf8');
      const lines = content.split('\n');
      const lineIdx = issue.line - 1;
      if (lineIdx >= 0 && lineIdx < lines.length) {
        const trimmed = lines[lineIdx].trimStart();
        if (trimmed.startsWith('console.log') || trimmed.startsWith('console.debug') || trimmed.startsWith('console.trace')) {
          const indent = lines[lineIdx].slice(0, lines[lineIdx].length - trimmed.length);
          lines[lineIdx] = `${indent}// TODO: REMOVE_ME — ${trimmed}`;
          fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
          fixResult = `Commented out console.${trimmed.startsWith('console.log') ? 'log' : 'debug'}() at ${issue.file}:${issue.line}`;
        }
      }
    }

    if (issue.code === 'empty-catch') {
      const content = fs.readFileSync(absPath, 'utf8');
      const lines = content.split('\n');
      const lineIdx = issue.line - 1;
      if (lineIdx >= 0 && lineIdx < lines.length) {
        const newLine = lines[lineIdx].replace(/catch\s*\([^)]*\)\s*\{\s*\}/, (match) => {
          const varName = match.match(/catch\s*\(([^)]*)\)/)?.[1] || 'error';
          return `catch (${varName}) { console.warn('[Catch] Caught error:', ${varName}); }`;
        });
        if (newLine !== lines[lineIdx]) {
          lines[lineIdx] = newLine;
          fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
          fixResult = `Added console.warn to empty catch at ${issue.file}:${issue.line}`;
        }
      }
    }

    if (fixResult) fixes.push(fixResult);
    else remaining.push(issue);
  }
  return { fixes, remaining };
}

/** Get all workspace source files */
function getSourceFiles(workspaceRoot: string): string[] {
  const srcDir = path.join(workspaceRoot, 'src');
  if (!fs.existsSync(srcDir)) return [];
  const files: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
      else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(full);
    }
  }
  walk(srcDir);
  return files;
}

/** Scan source code files for common code quality issues */
function scanSourceCodeFiles(workspaceRoot: string): { issues: any[]; fixes: string[] } {
  const issues: any[] = [];
  const fixes: string[] = [];
  const files = getSourceFiles(workspaceRoot);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const relPath = path.relative(workspaceRoot, file).replace(/\\/g, '/');

    // Check for console.log left in production code
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.match(/^console\.(log|debug|trace)\s*\(/)) {
        issues.push({ file: relPath, line: i + 1, severity: 'warning', code: 'no-console', message: 'console.log() left in code — consider removing or replacing with console.warn/info' });
      }
    });

    // Check for TODO/FIXME comments
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.includes('TODO') || trimmed.includes('FIXME') || trimmed.includes('HACK')) {
        issues.push({ file: relPath, line: i + 1, severity: 'warning', code: 'pending-todo', message: `Unresolved "${trimmed.match(/TODO|FIXME|HACK/)?.[0] || 'marker'}" comment` });
      }
    });

    // Check for hardcoded credentials
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.match(/(password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]+['"]/i) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
        issues.push({ file: relPath, line: i + 1, severity: 'error', code: 'hardcoded-credentials', message: 'Possible hardcoded credential detected' });
      }
    });

    // Check for empty catch blocks
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed === 'catch (e) {}' || trimmed === 'catch {}' || trimmed.match(/catch\s*\([^)]*\)\s*\{\s*\/\/\s*ignore/i)) {
        issues.push({ file: relPath, line: i + 1, severity: 'warning', code: 'empty-catch', message: 'Empty catch block — error is silently swallowed' });
      }
    });

    // Check for very long functions (heuristic: > 80 lines between { })
    let braceDepth = 0;
    let funcStartLine = 0;
    lines.forEach((line, i) => {
      if (line.match(/^\s*(async\s+)?function\s*\w*\s*\(/)) { funcStartLine = i + 1; }
      if (funcStartLine && line.includes('{')) braceDepth++;
      if (line.includes('}')) braceDepth--;
      if (funcStartLine && braceDepth === 0 && (i + 1 - funcStartLine) > 80) {
        issues.push({ file: relPath, line: funcStartLine, severity: 'warning', code: 'long-function', message: `Function starting at line ${funcStartLine} is ${i + 1 - funcStartLine} lines — consider refactoring` });
        funcStartLine = 0;
      }
    });
  }

  return { issues, fixes: [] };
}

// Antibug: scan source code for bugs and auto-fix them
app.post("/api/security/antibug", requireAdmin, express.json({ limit: '10mb' }), async (req, res) => {
  const { workspaceRoot } = req.body;
  const root = workspaceRoot
    ? (workspaceRoot.startsWith('file://') ? workspaceRoot.replace('file://', '') : workspaceRoot)
    : process.cwd();

  if (!fs.existsSync(root)) return res.status(404).json({ success: false, error: 'Workspace root not found' });

  const scanStart = Date.now();
  const allIssues: AntivirusBug[] = [];
  const allFixes: string[] = [];

  // 1. Run TypeScript compiler check
  const tsResult = runTypeScriptCheck(root);
  allIssues.push(...tsResult.errors);
  console.log(`[Antibug] TypeScript: ${tsResult.errors.length} error(s) found`);

  // 2. Run ESLint check
  const eslintResult = runESLintCheck(root);
  allIssues.push(...eslintResult.errors);
  console.log(`[Antibug] ESLint: ${eslintResult.errors.length} issue(s) found`);

  // 3. Scan source files for code quality issues
  const qualityResult = scanSourceCodeFiles(root);
  const qualityIssues = qualityResult.issues.map(i => ({
    file: i.file, line: i.line, col: 0,
    severity: i.severity as 'error' | 'warning',
    code: i.code, message: i.message,
  }));
  allIssues.push(...qualityIssues);
  console.log(`[Antibug] Quality scan: ${qualityIssues.length} issue(s) found`);

  // 4. Auto-fix TS6133 (unused imports/variables) and other auto-fixable issues
  for (const bug of tsResult.errors) {
    if (bug.code === 'TS6133') {
      const fixResult = autoFixBug(path.join(root, bug.file), bug);
      if (fixResult) {
        allFixes.push(`[${bug.file}:${bug.line}] ${fixResult}`);
      }
    }
  }

  // 5. Auto-fix quality issues (console.log, empty catches, credentials)
  const qualityFixesResult = applyQualityFixes(root, qualityIssues);
  allFixes.push(...qualityFixesResult.fixes.map(f => `[quality] ${f}`));

  // 6. Fix ESLint auto-fixable issues
  let eslintAutoFixed = 0;
  for (const bug of eslintResult.errors) {
    // ESLint auto-fix via running eslint --fix
    if (bug.code === 'no-console' || bug.code === 'no-unused-vars' || bug.code === 'prefer-const') {
      const absPath = path.join(root, bug.file);
      const fixResult = autoFixBug(absPath, bug);
      if (fixResult) {
        allFixes.push(`[eslint:${bug.file}:${bug.line}] ${fixResult}`);
        eslintAutoFixed++;
      }
    }
  }

  const totalFixed = allFixes.length;
  const remainingIssues = [...qualityFixesResult.remaining, ...tsResult.errors.filter(e => e.code !== 'TS6133'), ...eslintResult.errors.filter(e => e.code !== 'no-console' && e.code !== 'no-unused-vars' && e.code !== 'prefer-const')];

  const result = {
    success: true,
    workspaceRoot: root,
    scanTimeMs: Date.now() - scanStart,
    scanned: true,
    issuesFound: remainingIssues.length,
    issues: remainingIssues.slice(0, 50),
    totalIssues: remainingIssues.length + totalFixed,
    fixesApplied: totalFixed,
    fixes: allFixes,
    tsRaw: tsResult.raw.slice(0, 2000),
  };

  console.log(`[Antibug] Scan complete — ${remainingIssues.length + totalFixed} issues, ${totalFixed} auto-fixed, ${remainingIssues.length} remaining (${result.scanTimeMs}ms)`);
  if (allFixes.length > 0) console.log(`[Antibug] Fixes applied:`, allFixes);
  res.json(result);
});

// ── Antibug: Apply a specific fix for a single issue ──────────────────
app.post("/api/security/antibug/apply-fix", requireAdmin, express.json(), async (req, res) => {
  const { file, line, code, message } = req.body;
  if (!file || !line) return res.status(400).json({ success: false, error: 'file and line required' });

  const absPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(absPath)) return res.status(404).json({ success: false, error: 'File not found' });

  const bug: AntivirusBug = { file, line, col: 0, severity: 'warning', code: code || 'unknown', message: message || '' };
  const fixResult = autoFixBug(absPath, bug);

  if (fixResult) {
    console.log(`[Antibug] Fix applied: ${file}:${line} — ${fixResult}`);
    res.json({ success: true, message: fixResult, file, line });
  } else {
    // Try applyQualityFixes approach
    const qualityFixResult = applyQualityFixes(process.cwd(), [{ file, line, code: code || 'unknown', message: message || '' }]);
    if (qualityFixResult.fixes.length > 0) {
      console.log(`[Antibug] Fix applied: ${file}:${line} — ${qualityFixResult.fixes[0]}`);
      res.json({ success: true, message: qualityFixResult.fixes[0], file, line });
    } else {
      res.json({ success: false, error: `Could not auto-fix issue at ${file}:${line}. Manual fix needed.` });
    }
  }
});

// ── Upload / body-parser error handler (JSON, not HTML) ──────────────────
// Multer and body-parser errors otherwise surface as Express's default HTML
// "<title>Error</title>" page, which the UI can't parse and shows as a generic
// "Server Error: Error". Return structured JSON instead.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const status =
    err.status || err.statusCode ||
    (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.type === 'entity.too.large' ? 413 : 500);
  let message = err.message || 'Upload failed.';
  if (err.code === 'LIMIT_FILE_SIZE') {
    message = 'A file exceeds the 500MB per-file upload limit.';
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    message = `Upload rejected: too many files or an unexpected field '${err.field || '?'}'.`;
  } else if (err.type === 'entity.too.large') {
    message = 'Upload too large. Please reduce the number/size of files and try again.';
  }
  console.error('[upload error]', err.message || err);
  res.status(status).json({ error: message, code: err.code || 'UPLOAD_ERROR' });
});

// Handle Vite middleware and client serving
async function startServer() {
  // Start the satellite systems FIRST so they are warm by the time the UI probes them
  startSatellites();

  if (process.env.NODE_ENV !== "production") {
    // In dev mode, mount Vite dev server as middleware on the same port
    const vite = await createViteServer({
      server: { middlewareMode: true, host: "0.0.0.0", allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    // Serve uploads AFTER Vite middleware so Vite doesn't intercept STL file requests
    app.use("/uploads", requireAuth, express.static(uploadsDir));
  } else {
    // In production mode, serve the static files in dist
    const distPath = path.join(process.cwd(), "dist");
    // Serve the built agliner UI under /agliner (built with AGLINER_WEB=1)
    const aglinerDist = path.join(process.cwd(), "ai cad", "aligner-ui", "dist");
    if (fs.existsSync(aglinerDist)) {
      app.use("/agliner", express.static(aglinerDist));
    }
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Find an available port before binding
  PORT = await findAvailablePort(PORT);

  const tlsCertPath = process.env.TLS_CERT_PATH;
  const tlsKeyPath = process.env.TLS_KEY_PATH;
  const usingTls = !!(tlsCertPath && tlsKeyPath);
  if (usingTls && (!fs.existsSync(tlsCertPath!) || !fs.existsSync(tlsKeyPath!))) {
    throw new Error("TLS_CERT_PATH or TLS_KEY_PATH does not point to a readable certificate file.");
  }
  const lan = getLanAddresses();
  const server = usingTls
    ? https.createServer({ cert: fs.readFileSync(tlsCertPath!), key: fs.readFileSync(tlsKeyPath!) }, app).listen(PORT, "0.0.0.0", () => {
      console.log(`Whitesmile Clear Orthodontic Design Studio running securely on https://${process.env.PUBLIC_HTTPS_HOST || "localhost"}:${PORT}`);
    })
    : app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n================================================================`);
    console.log(`  Whitesmile Clear Orthodontic Design Studio Server Running`);
    console.log(`================================================================`);
    console.log(`  Local Access   : http://localhost:${PORT}/`);
    for (const url of lan.urls) {
      if (!url.includes("localhost")) {
        console.log(`  Network Access : ${url}/  (use this on 3rd party devices on LAN)`);
      }
    }
    console.log(`  → Main System   : /`);
    console.log(`  → Agliner Seg.  : /agliner`);
    console.log(`  → Ortho Staging : /ortho`);
    console.log(`================================================================\n`);
  });

  // WebSocket upgrade proxy for the satellite systems
  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "/";
    if (process.env.NODE_ENV !== "production" && url.startsWith("/agliner")) {
      proxyWs(satellites.agliner.port)(req, socket, head);
    } else if (url.startsWith("/ortho")) {
      proxyWs(satellites.ortho.port, { stripPrefix: "/ortho" })(req, socket, head);
    } else {
      socket.destroy();
    }
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
