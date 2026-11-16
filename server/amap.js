const API_BASE = "https://restapi.amap.com/v3";
const TIMEOUT_MS = 8000;

/** 名称里的品类线索，用于补 tags（高德 type 与 biz_ext.tag 常常不覆盖） */
const NAME_TAGS = [
  "火锅", "烧烤", "烤肉", "烤鱼", "拉面", "牛肉面", "面馆", "米线", "披萨", "意面",
  "寿司", "刺身", "日料", "韩餐", "咖啡", "甜品", "粥", "素食", "清真", "川菜",
  "粤菜", "湘菜", "西餐", "点心", "轻食", "夜宵", "早餐",
];

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLngLatString(text) {
  const parts = String(text || "").split(",");
  if (parts.length !== 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

async function amapGet(path, params) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    query.set(name, String(value));
  }
  const url = API_BASE + path + "?" + query.toString();
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new Error("请求高德接口失败（" + path + "）：" + (err && err.message ? err.message : err));
  }
  if (!res.ok) throw new Error("高德接口 HTTP " + res.status + "（" + path + "）");
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error("高德接口返回的不是合法 JSON（" + path + "）");
  }
  if (String(body.status) !== "1") {
    const info = body.info || "未知错误";
    const infocode = body.infocode || "无";
    throw new Error("高德返回错误：" + info + "（infocode=" + infocode + "）");
  }
  return body;
}

function pickOpenTime(bizExt) {
  const raw = bizExt ? bizExt.open_time : "";
  if (Array.isArray(raw)) return String(raw[0] || "");
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function buildTags(poi, category, name) {
  const raw = [];
  if (category) raw.push(category);
  const extTag = poi.biz_ext ? poi.biz_ext.tag : "";
  if (Array.isArray(extTag)) raw.push(...extTag);
  else if (extTag) raw.push(...String(extTag).split(/[,;|、\s]+/));
  for (const word of NAME_TAGS) {
    if (name.includes(word)) raw.push(word);
  }
  const tags = [];
  for (const item of raw) {
    const tag = String(item || "").trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function mapPoi(poi) {
  const location = parseLngLatString(poi.location);
  if (!location) throw new Error("高德返回的门店坐标无法解析：" + String(poi.name || poi.id));
  const typeParts = String(poi.type || "").split(";").filter(Boolean);
  const category = typeParts.length ? typeParts[typeParts.length - 1] : "";
  const name = String(poi.name || "").trim();
  const bizExt = poi.biz_ext || {};
  const distance = toNumber(poi.distance);
  const photos = Array.isArray(poi.photos)
    ? poi.photos.map((p) => (p && typeof p.url === "string" ? p.url : "")).filter(Boolean)
    : [];
  const tel = Array.isArray(poi.tel) ? poi.tel.filter(Boolean).join(",") : String(poi.tel || "").trim();
  return {
    id: String(poi.id || ""),
    name,
    type: String(poi.type || ""),
    category,
    address: Array.isArray(poi.address) ? "" : String(poi.address || "").trim(),
    location,
    distance: distance === null ? null : Math.round(distance),
    rating: toNumber(bizExt.rating),
    cost: toNumber(bizExt.cost),
    reviewCount: null,
    tags: buildTags(poi, category, name),
    openNow: null,
    openTime: pickOpenTime(bizExt),
    phone: tel,
    photos,
    source: "amap",
  };
}

function matchesKeyword(poi, keyword) {
  const needle = keyword.toLowerCase();
  const haystack = [poi.name, poi.type, poi.address, poi.biz_ext && poi.biz_ext.tag]
    .map((v) => (Array.isArray(v) ? v.join(" ") : String(v || "")))
    .join(" ");
  return haystack.toLowerCase().includes(needle);
}

/**
 * 周边搜索，按距离排序。
 * 关键词策略：选「在 v3/place/around 上补 keywords」而不是改走 v3/place/text。
 * 理由：place/text 必须给 city 锚点，否则是全国范围的文本检索，既丢失 location+radius 的空间语义，
 * 也拿不到 sortrule=distance 的距离排序；around + keywords 能同时保证「附近」与「按距离」，更稳。
 * 若某些 Key 忽略了 keywords（返回 0 条），再去掉关键词重取一次并在本地按关键词过滤，避免误判为空。
 */
export async function amapSearchPlaces({ lng, lat, radius = 2000, keyword = "", page = 1, limit = 30, key }) {
  if (!key) throw new Error("缺少高德 Web 服务 Key");
  const requestRadius = Math.min(Math.max(Math.round(Number(radius) || 2000), 1), 50000);
  const requestPage = Math.min(Math.max(Math.round(Number(page) || 1), 1), 100);
  const offset = Math.min(Math.max(Math.round(Number(limit) || 25), 1), 25);
  const params = {
    key,
    location: lng + "," + lat,
    radius: requestRadius,
    types: "050000",
    offset,
    page: requestPage,
    extensions: "all",
    sortrule: "distance",
  };
  const wanted = String(keyword || "").trim();
  if (wanted) params.keywords = wanted;

  let body = await amapGet("/place/around", params);
  let pois = Array.isArray(body.pois) ? body.pois : [];
  if (wanted && pois.length === 0) {
    delete params.keywords;
    body = await amapGet("/place/around", params);
    pois = (Array.isArray(body.pois) ? body.pois : []).filter((poi) => matchesKeyword(poi, wanted));
  }

  const places = pois.map(mapPoi).slice(0, Math.max(Math.round(Number(limit) || 25), 1));
  return {
    source: "amap",
    center: { lng: Number(lng), lat: Number(lat) },
    count: places.length,
    places,
  };
}

function pushPolyline(path, polyline) {
  for (const chunk of String(polyline || "").split(";")) {
    const point = parseLngLatString(chunk);
    if (!point) continue;
    const pair = [point.lng, point.lat];
    const last = path.length ? path[path.length - 1] : null;
    // 相邻 step 共用端点，去掉首尾重复点，保证路径连续且无零长度段
    if (last && last[0] === pair[0] && last[1] === pair[1]) continue;
    path.push(pair);
  }
}

export async function amapPlanRoute({ from, to, mode = "walking", key }) {
  if (!key) throw new Error("缺少高德 Web 服务 Key");
  if (!from || !to) throw new Error("起点或终点缺失");
  const type = mode === "driving" ? "driving" : "walking";
  const body = await amapGet("/direction/" + type, {
    key,
    origin: from.lng + "," + from.lat,
    destination: to.lng + "," + to.lat,
  });
  const route = body.route || {};
  const first = Array.isArray(route.paths) ? route.paths[0] : null;
  if (!first) throw new Error("高德未返回可用路径：" + (body.info || "无 paths"));
  const distance = toNumber(first.distance);
  const duration = toNumber(first.duration);
  if (distance === null || distance <= 0) throw new Error("高德返回的路径距离无效：" + String(first.distance));
  if (duration === null || duration <= 0) throw new Error("高德返回的耗时无效：" + String(first.duration));
  const path = [];
  for (const step of Array.isArray(first.steps) ? first.steps : []) {
    pushPolyline(path, step.polyline);
  }
  if (path.length < 2) throw new Error("高德返回的 polyline 点数不足");
  return {
    mode: type,
    distance: Math.round(distance),
    duration: Math.round(duration),
    path,
    source: "amap",
  };
}
