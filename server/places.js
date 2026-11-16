import { getConfig } from "./config.js";
import { amapSearchPlaces } from "./amap.js";
import { mockPlaces } from "./mock.js";

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * 统一取数入口：有高德 Web 服务 Key 走实时数据，失败或无 Key 退回演示数据。
 * 兜底时返回 notice 说明原因，前端状态条据此提示数据来源。
 * @returns {Promise<{source: "amap"|"mock", center: {lng:number, lat:number}, count: number, places: Array<object>, notice?: string}>}
 */
export async function searchPlaces({ lng, lat, radius = 2000, keyword = "", page = 1, limit = 30 }) {
  const cfg = getConfig();
  const query = {
    lng: Number(lng),
    lat: Number(lat),
    radius: clamp(radius, 100, 50000, 2000),
    keyword: String(keyword || "").trim(),
    page: Math.round(clamp(page, 1, 100, 1)),
    limit: Math.round(clamp(limit, 1, 50, 30)),
  };
  if (cfg.hasAmapKey) {
    try {
      return await amapSearchPlaces({ ...query, key: cfg.amapWebKey });
    } catch (err) {
      const reason = err && err.message ? err.message : String(err);
      console.warn("[places] 高德接口失败，退回演示数据:", reason);
      const fallback = mockPlaces(query);
      return { ...fallback, notice: "高德接口调用失败，已切换演示数据：" + reason };
    }
  }
  return mockPlaces(query);
}
