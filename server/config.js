import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let cached = null;

export function getConfig() {
  if (cached) return cached;
  let raw = {};
  const file = join(ROOT, "config.json");
  if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, "utf8")); }
    catch (err) { console.warn("[config] config.json 解析失败，按空配置处理:", err.message); }
  }
  const amapWebKey = String(process.env.AMAP_WEB_KEY || raw.amapWebKey || "").trim();
  const amapJsKey = String(process.env.AMAP_JS_KEY || raw.amapJsKey || "").trim();
  const amapSecurityJsCode = String(process.env.AMAP_SECURITY_CODE || raw.amapSecurityJsCode || "").trim();
  const port = Number(process.env.PORT || raw.port || 5173);
  const center = raw.defaultCenter || {};
  const defaultCenter =
    Number.isFinite(Number(center.lng)) && Number.isFinite(Number(center.lat)) && center.lng !== undefined && center.lat !== undefined
      ? { lng: Number(center.lng), lat: Number(center.lat) }
      : null;
  cached = {
    amapWebKey, amapJsKey, amapSecurityJsCode, port, defaultCenter,
    hasAmapKey: amapWebKey.length > 0,
    mode: amapWebKey ? "amap" : "mock",
  };
  return cached;
}
