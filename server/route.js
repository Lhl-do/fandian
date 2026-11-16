import { getConfig } from "./config.js";
import { amapPlanRoute } from "./amap.js";

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * 路径规划：有 Key 走高德，失败或无 Key 退回直线示意（按步行/驾车速度估算耗时）。
 * 兜底时带 notice 说明原因。
 */
export async function planRoute({ from, to, mode = "walking" }) {
  const cfg = getConfig();
  const safeMode = mode === "driving" ? "driving" : "walking";
  if (!from || !to || !Number.isFinite(from.lng) || !Number.isFinite(from.lat) || !Number.isFinite(to.lng) || !Number.isFinite(to.lat)) {
    throw new Error("起终点坐标不合法");
  }
  let notice;
  if (cfg.hasAmapKey) {
    try {
      return await amapPlanRoute({ from, to, mode: safeMode, key: cfg.amapWebKey });
    } catch (err) {
      const reason = err && err.message ? err.message : String(err);
      console.warn("[route] 高德路径规划失败，退回直线示意:", reason);
      notice = "高德路径规划失败，已用直线距离示意：" + reason;
    }
  }
  const distance = haversine(from, to);
  const speed = safeMode === "walking" ? 1.25 : 7;
  const result = {
    mode: safeMode,
    distance,
    duration: Math.max(1, Math.round(distance / speed)),
    path: [[from.lng, from.lat], [to.lng, to.lat]],
    source: "mock",
  };
  if (notice) result.notice = notice;
  return result;
}
