import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { searchPlaces } from "./places.js";
import { planRoute } from "./route.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function sendJson(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": "inline",
  });
  res.end(text);
}

function parseLngLat(value) {
  if (!value) return null;
  const parts = String(value).split(",").map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  return { lng: parts[0], lat: parts[1] };
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function readPublicFile(relPath) {
  const rel = normalize(decodeURIComponent(relPath)).replace(/^[\\/]+/, "");
  const target = join(PUBLIC_DIR, rel === "" ? "index.html" : rel);
  if (!target.startsWith(PUBLIC_DIR)) return { status: 403, body: null, rel };
  try {
    const [body, info] = await Promise.all([readFile(target), stat(target)]);
    return { status: 200, body, rel, mtime: info.mtimeMs, size: info.size };
  } catch {
    return { status: 404, body: null, rel };
  }
}

function reqHeaderMatches(res, name, value) {
  const raw = res.req && res.req.headers ? res.req.headers[name] : undefined;
  return Boolean(raw) && String(raw).split(",").some((t) => t.trim() === value);
}

async function serveStatic(res, pathname) {
  const { status, body, rel, mtime, size } = await readPublicFile(pathname);
  if (status === 200) {
    const typePath = rel === "" ? "index.html" : rel;
    const etag = 'W/"' + size.toString(16) + "-" + Math.round(mtime).toString(16) + '"';
    const headers = {
      "content-type": MIME[extname(typePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
      "content-disposition": "inline",
      etag,
    };
    if (reqHeaderMatches(res, "if-none-match", etag)) {
      res.writeHead(304, { "cache-control": "no-cache", etag, "content-disposition": "inline" });
      return res.end();
    }
    res.writeHead(200, headers);
    return res.end(body);
  }
  if (status === 403) return sendJson(res, 403, { ok: false, error: "forbidden" });
  const fallback = await readPublicFile("index.html");
  if (fallback.body) {
    res.writeHead(200, {
      "content-type": MIME[".html"],
      "cache-control": "no-cache",
      "content-disposition": "inline",
    });
    return res.end(fallback.body);
  }
  sendJson(res, 404, { ok: false, error: "not found: " + rel });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname;
  const params = url.searchParams;
  try {
    if (path === "/api/health") {
      const cfg = getConfig();
      return sendJson(res, 200, { ok: true, mode: cfg.mode, uptime: Math.round(process.uptime()) });
    }
    if (path === "/api/config") {
      const cfg = getConfig();
      return sendJson(res, 200, {
        ok: true,
        mode: cfg.mode,
        hasAmapKey: cfg.hasAmapKey,
        amapJsKey: cfg.amapJsKey || null,
        amapSecurityJsCode: cfg.amapSecurityJsCode || null,
        defaultCenter: cfg.defaultCenter || null,
      });
    }
    if (path === "/api/places") {
      const lng = num(params.get("lng"));
      const lat = num(params.get("lat"));
      if (lng === null || lat === null) return sendJson(res, 400, { ok: false, error: "lng 与 lat 必填" });
      const result = await searchPlaces({
        lng, lat,
        radius: num(params.get("radius")) ?? 2000,
        keyword: (params.get("keyword") || "").trim(),
        page: num(params.get("page")) ?? 1,
        limit: num(params.get("limit")) ?? 30,
      });
      return sendJson(res, 200, { ok: true, ...result });
    }
    if (path === "/api/route") {
      const from = parseLngLat(params.get("from"));
      const to = parseLngLat(params.get("to"));
      if (!from || !to) return sendJson(res, 400, { ok: false, error: "from 与 to 需为 lng,lat" });
      const mode = params.get("mode") === "driving" ? "driving" : "walking";
      return sendJson(res, 200, { ok: true, ...(await planRoute({ from, to, mode })) });
    }
    if (path.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "unknown api: " + path });
    return await serveStatic(res, path);
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
  }
});

const cfg = getConfig();
server.listen(cfg.port, () => {
  console.log("饭点已启动 → http://127.0.0.1:" + cfg.port);
  console.log("数据模式: " + (cfg.mode === "amap" ? "高德实时数据" : "演示数据（未配置 amapWebKey）"));
});