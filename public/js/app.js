/* 饭点 · 前端壳
 * 编排：地图（高德 JS API / 无 Key 时的 SVG 相对方位图）、门店列表、详情、搜索、定位、路线与导航。
 * 打分、偏好档案、导航深链分别由 score.js / prefs.js / nav.js 提供，这里不重复实现。
 */

import { rankPlaces } from "./score.js";
import { renderPrefsPanel, loadActiveProfile, DEFAULT_PREFS } from "./prefs.js";
import { amapNavUrl, baiduNavUrl } from "./nav.js";

let DEFAULT_CENTER = { lng: 121.4737, lat: 31.2304 }; // 上海人民广场，可被 /api/config 的 defaultCenter 覆盖
const DEFAULT_RADIUS = 2000;
const PLACE_LIMIT = 30;
const LOCATION_FAILED = "未取到定位，已用默认位置";
const SVG_NS = "http://www.w3.org/2000/svg";
const DIRECTIONS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

const $ = (id) => document.getElementById(id);

const dom = {
  map: $("map"),
  mapHint: $("map-hint"),
  status: $("status-bar"),
  form: $("search-form"),
  input: $("search-input"),
  locate: $("locate-btn"),
  count: $("result-count"),
  list: $("result-list"),
  detail: $("detail-panel"),
  detailName: $("detail-name"),
  detailScore: $("detail-score"),
  detailFacts: $("detail-facts"),
  detailReasons: $("detail-reasons"),
  detailWarnings: $("detail-warnings"),
  detailPhotos: $("detail-photos"),
  detailClose: $("detail-close"),
  routeBtn: $("route-btn"),
  routeInfo: $("route-info"),
  navAmap: $("nav-amap-btn"),
  navBaidu: $("nav-baidu-btn"),
  prefsPanel: $("prefs-panel"),
  prefsToggle: $("prefs-toggle"),
};

const state = {
  center: { ...DEFAULT_CENTER },
  myLocation: null,
  located: false,
  locationMessage: "",
  prefs: DEFAULT_PREFS,
  places: [],
  ranked: [],
  selected: null,
  keyword: "",
  source: "",
  notice: "",
  mapNotice: "",
  error: "",
  loading: false,
  map: null,
};

/* ---------- 小工具 ---------- */

function messageOf(err) {
  return err && err.message ? err.message : String(err);
}

function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

function formatDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return "距离未知";
  if (m < 1000) return Math.round(m) + " 米";
  return (m / 1000).toFixed(1) + " 公里";
}

function formatCost(cost) {
  const n = Number(cost);
  return Number.isFinite(n) ? "¥" + Math.round(n) : "人均未知";
}

function formatRating(rating) {
  const n = Number(rating);
  return Number.isFinite(n) ? n.toFixed(1) : "暂无评分";
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "时间未知";
  if (s < 60) return Math.round(s) + " 秒";
  return Math.round(s / 60) + " 分钟";
}

function scoreText(score) {
  return Math.round(Number(score) || 0) + " 分";
}

function radiusOf(prefs) {
  const n = Number(prefs && prefs.maxDistance);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS;
}

function chip(label, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text(label);
  return span;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (data && data.ok === false) throw new Error(text(data.error) || "请求失败");
  return data;
}

/* ---------- 状态条 ---------- */

function renderStatus() {
  const parts = [];
  if (state.error) parts.push(state.error);
  else if (state.loading) parts.push("正在获取附近门店…");
  else if (state.source === "amap") parts.push("数据源：高德实时");
  else if (state.source === "mock") parts.push("数据源：演示数据");
  else parts.push("正在连接服务…");

  if (state.locationMessage) parts.push(state.locationMessage);
  if (state.mapNotice) parts.push(state.mapNotice);
  if (state.notice) parts.push(state.notice);
  if (state.keyword) parts.push("关键词：" + state.keyword);
  if (state.ranked.length) parts.push("共 " + state.ranked.length + " 家");

  dom.status.textContent = parts.join(" · ");
  const warn = Boolean(state.error) || state.locationMessage === LOCATION_FAILED;
  dom.status.dataset.tone = warn ? "warn" : "info";
}

function setMapHint(label) {
  dom.mapHint.textContent = label;
}

/* ---------- 地图：SVG 相对方位图（降级路径） ---------- */

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      if (attrs[key] !== undefined && attrs[key] !== null) node.setAttribute(key, String(attrs[key]));
    }
  }
  return node;
}

function metersOffset(center, point) {
  const dLng = Number(point.lng) - Number(center.lng);
  const dLat = Number(point.lat) - Number(center.lat);
  const east = dLng * 111320 * Math.cos((Number(center.lat) * Math.PI) / 180);
  const north = dLat * 110540;
  return { east, north, dist: Math.hypot(east, north) };
}

function directionName(east, north) {
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
  return DIRECTIONS[idx];
}

function createSvgMap(container, onPick) {
  const SIZE = 520;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const OUTER = SIZE / 2 - 56;

  const root = svgNode("svg", {
    class: "dir-map",
    viewBox: "0 0 " + SIZE + " " + SIZE,
    role: "img",
    "aria-label": "门店相对方位图",
  });
  const rings = svgNode("g", { class: "dir-rings" });
  const routeLayer = svgNode("g", { class: "dir-route" });
  const dots = svgNode("g", { class: "dir-dots" });
  const centerLayer = svgNode("g", { class: "dir-center" });
  root.append(rings, routeLayer, dots, centerLayer);
  container.replaceChildren(root);

  let center = { ...DEFAULT_CENTER };
  let maxRadius = DEFAULT_RADIUS;

  // 经纬度差 → 平面偏移：east 向右，north 向上，距离按米等比压缩到画布半径。
  function project(point, index) {
    const { east, north, dist } = metersOffset(center, point);
    if (dist < 1) {
      // 门店与中心点重合（演示数据常见）：沿固定角度铺开，避免全部叠在圆心。
      const angle = (Math.PI * 2 * index) / 12 + Math.PI / 12;
      return { x: CX + Math.cos(angle) * OUTER * 0.42, y: CY + Math.sin(angle) * OUTER * 0.42, east, north, dist };
    }
    const r = Math.min((dist / maxRadius) * OUTER, OUTER);
    return { x: CX + (east / dist) * r, y: CY - (north / dist) * r, east, north, dist };
  }

  function drawRings() {
    rings.replaceChildren();
    for (let i = 1; i <= 3; i += 1) {
      const r = (OUTER * i) / 3;
      rings.append(svgNode("circle", { cx: CX, cy: CY, r: r.toFixed(1) }));
      if (i === 3) {
        const label = svgNode("text", { x: CX, y: (CY - r - 8).toFixed(1), "text-anchor": "middle" });
        label.textContent = formatDistance(maxRadius);
        rings.append(label);
      }
    }
    const north = svgNode("text", { x: CX, y: (CY - OUTER - 28).toFixed(1), "text-anchor": "middle", class: "dir-north" });
    north.textContent = "北";
    rings.append(north);
  }

  function drawCenter() {
    const dot = svgNode("circle", { cx: CX, cy: CY, r: 9 });
    const label = svgNode("text", { x: CX, y: CY + 4 });
    label.textContent = "我";
    centerLayer.replaceChildren(dot, label);
  }

  function renderPlaces(places, options) {
    const opts = options || {};
    if (opts.center) center = { lng: Number(opts.center.lng), lat: Number(opts.center.lat) };
    const radius = Number(opts.radius);
    maxRadius = Math.max(Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_RADIUS, 300);
    const selectedId = opts.selectedId || null;

    drawRings();
    drawCenter();
    dots.replaceChildren();

    const list = Array.isArray(places) ? places : [];
    list.forEach((place, index) => {
      if (!place || !place.location) return;
      const proj = project(place.location, index);
      const distance = place.distance === null || place.distance === undefined ? Math.round(proj.dist) : Number(place.distance);
      const dir = proj.dist < 1 ? "附近" : directionName(proj.east, proj.north);
      const active = place.id === selectedId;

      const group = svgNode("g", {
        class: active ? "dir-dot is-active" : "dir-dot",
        "data-id": place.id,
        transform: "translate(" + proj.x.toFixed(1) + " " + proj.y.toFixed(1) + ")",
      });
      const title = svgNode("title");
      title.textContent = text(place.name) + " · " + dir + " " + formatDistance(distance);
      const circle = svgNode("circle", { cx: 0, cy: 0, r: 11 });
      const num = svgNode("text", { class: "idx", x: 0, y: 4 });
      num.textContent = String(index + 1);
      const meta = svgNode("text", { class: "meta", x: 15, y: 4 });
      meta.textContent = dir + " " + formatDistance(distance);

      group.append(title, circle, num, meta);
      dots.append(group);
    });
  }

  function focus() {
    // 相对方位图不做缩放；选中态由 renderPlaces 的 is-active 表达。
  }

  function drawRoute(path) {
    routeLayer.replaceChildren();
    if (!Array.isArray(path) || path.length < 2) return;
    const points = path
      .map((point, index) => {
        const lng = Array.isArray(point) ? Number(point[0]) : Number(point.lng);
        const lat = Array.isArray(point) ? Number(point[1]) : Number(point.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        const proj = project({ lng, lat }, index);
        return proj.x.toFixed(1) + "," + proj.y.toFixed(1);
      })
      .filter(Boolean)
      .join(" ");
    if (!points) return;
    routeLayer.append(svgNode("polyline", { points: points }));
  }

  function clearRoute() {
    routeLayer.replaceChildren();
  }

  root.addEventListener("click", (event) => {
    let node = event.target;
    while (node && node !== root && !(node.getAttribute && node.getAttribute("data-id"))) node = node.parentNode;
    if (!node || node === root) return;
    const id = node.getAttribute("data-id");
    if (id) onPick(id);
  });

  return { kind: "svg", renderPlaces, focus, drawRoute, clearRoute };
}

/* ---------- 地图：高德 JS API ---------- */

function loadAmapScript(config) {
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      resolve(window.AMap);
      return;
    }
    if (config.amapSecurityJsCode) {
      window._AMapSecurityConfig = { securityJsCode: config.amapSecurityJsCode };
    }
    const script = document.createElement("script");
    script.src = "https://webapi.amap.com/maps?v=2.0&key=" + encodeURIComponent(config.amapJsKey);
    script.async = true;
    const timer = setTimeout(() => reject(new Error("加载超时")), 12000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.AMap) resolve(window.AMap);
      else reject(new Error("脚本已加载但 AMap 未就绪"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("脚本请求失败"));
    };
    document.head.appendChild(script);
  });
}

function createAmap(AMap, container, onPick) {
  const map = new AMap.Map(container, { zoom: 15, viewMode: "2D", resizeEnable: true });
  let markers = [];
  let routeLine = null;

  function dropMarkers() {
    markers.forEach((marker) => map.remove(marker));
    markers = [];
  }

  function dotContent(label, className) {
    return '<div class="amap-dot ' + className + '">' + label + "</div>";
  }

  function renderPlaces(places, options) {
    const opts = options || {};
    const selectedId = opts.selectedId || null;
    dropMarkers();

    if (opts.center) {
      const center = { lng: Number(opts.center.lng), lat: Number(opts.center.lat) };
      map.setCenter([center.lng, center.lat]);
      const me = new AMap.Marker({
        position: [center.lng, center.lat],
        content: dotContent("我", "is-me"),
        offset: new AMap.Pixel(-13, -13),
        title: "我的位置",
        zIndex: 200,
      });
      map.add(me);
      markers.push(me);
    }

    const list = Array.isArray(places) ? places : [];
    list.forEach((place, index) => {
      if (!place || !place.location) return;
      const marker = new AMap.Marker({
        position: [Number(place.location.lng), Number(place.location.lat)],
        content: dotContent(String(index + 1), place.id === selectedId ? "is-active" : ""),
        offset: new AMap.Pixel(-13, -13),
        title: text(place.name),
        zIndex: 100 + list.length - index,
      });
      marker.on("click", () => onPick(place.id));
      map.add(marker);
      markers.push(marker);
    });
  }

  function focus(place) {
    if (!place || !place.location) return;
    map.setZoomAndCenter(16, [Number(place.location.lng), Number(place.location.lat)]);
  }

  function drawRoute(path) {
    clearRoute();
    if (!Array.isArray(path) || path.length < 2) return;
    const points = path
      .map((point) => {
        const lng = Array.isArray(point) ? Number(point[0]) : Number(point.lng);
        const lat = Array.isArray(point) ? Number(point[1]) : Number(point.lat);
        return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
      })
      .filter(Boolean);
    if (points.length < 2) return;
    routeLine = new AMap.Polyline({
      path: points,
      strokeColor: "#f26430",
      strokeWeight: 6,
      strokeOpacity: 0.9,
      lineJoin: "round",
      showDir: true,
      map: map,
    });
    map.setFitView([routeLine], false, [60, 60, 60, 60]);
  }

  function clearRoute() {
    if (routeLine) {
      map.remove(routeLine);
      routeLine = null;
    }
  }

  return { kind: "amap", renderPlaces, focus, drawRoute, clearRoute };
}

async function setupMap(config) {
  if (config && config.hasAmapKey && config.amapJsKey) {
    try {
      const AMap = await loadAmapScript(config);
      state.map = createAmap(AMap, dom.map, onMapPick);
      setMapHint("高德地图");
      return;
    } catch (err) {
      console.warn("[map] 高德 JS API 不可用，改用相对方位图：", messageOf(err));
      state.mapNotice = "高德地图加载失败，已改用相对方位图";
    }
  }
  state.map = createSvgMap(dom.map, onMapPick);
  setMapHint("相对方位图");
}

function onMapPick(id) {
  selectPlace(id);
}

function syncMap() {
  if (!state.map) return;
  const places = state.ranked.length ? state.ranked.map((item) => item.place) : state.places;
  state.map.renderPlaces(places, {
    center: state.center,
    radius: radiusOf(state.prefs),
    selectedId: state.selected ? state.selected.place.id : null,
  });
}

/* ---------- 取数与排序 ---------- */

async function loadPlaces() {
  const params = new URLSearchParams({
    lng: String(state.center.lng),
    lat: String(state.center.lat),
    radius: String(radiusOf(state.prefs)),
    limit: String(PLACE_LIMIT),
  });
  if (state.keyword) params.set("keyword", state.keyword);

  state.loading = true;
  state.error = "";
  renderStatus();
  try {
    const data = await getJson("/api/places?" + params.toString());
    state.places = Array.isArray(data.places) ? data.places : [];
    state.source = text(data.source);
    state.notice = text(data.notice);
  } catch (err) {
    state.places = [];
    state.error = "取数失败：" + messageOf(err);
  } finally {
    state.loading = false;
  }
  renderRanked();
}

// 排序与打分全部来自 score.js，这里只按分数从高到低渲染。
function renderRanked() {
  const ranked = rankPlaces(state.places, state.prefs);
  state.ranked = (Array.isArray(ranked) ? ranked : [])
    .filter((item) => item && item.place)
    .slice()
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

  if (state.selected) {
    const stillThere = state.ranked.find((item) => item.place.id === state.selected.place.id);
    state.selected = stillThere || null;
    if (!stillThere) hideDetail();
  }
  renderList();
  renderStatus();
}

/* ---------- 列表 ---------- */

function renderList() {
  dom.list.replaceChildren();
  dom.count.textContent = state.ranked.length ? state.ranked.length + " 家" : "";

  if (!state.ranked.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = state.loading
      ? "正在获取附近门店…"
      : "附近没有符合条件的门店，试试换个关键词或放宽偏好。";
    dom.list.append(empty);
  } else {
    const frag = document.createDocumentFragment();
    state.ranked.forEach((item, index) => frag.append(createCard(item, index)));
    dom.list.append(frag);
  }
  syncMap();
}

function createCard(item, index) {
  const place = item.place || {};
  const active = state.selected && state.selected.place && state.selected.place.id === place.id;

  // 饮食约束不匹配的店仍是 0 分而不是隐藏：排在最后并保留红色警告，让用户看清被排除的原因。
  const excluded = (Number(item.score) || 0) <= 0;
  const card = document.createElement("article");
  card.className = "card" + (active ? " is-active" : "") + (excluded ? " is-excluded" : "");
  card.dataset.id = text(place.id);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "查看 " + text(place.name) + " 的详情");

  const head = document.createElement("div");
  head.className = "card-head";
  const rank = document.createElement("span");
  rank.className = "card-rank";
  rank.textContent = String(index + 1);
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = text(place.name) || "未命名门店";
  const score = document.createElement("span");
  score.className = "score-badge";
  score.textContent = scoreText(item.score);
  head.append(rank, title, score);

  const meta = document.createElement("p");
  meta.className = "card-meta";
  const metaParts = [];
  if (place.category) metaParts.push(text(place.category));
  metaParts.push(formatDistance(place.distance));
  metaParts.push(place.rating === null || place.rating === undefined ? "暂无评分" : "★ " + formatRating(place.rating));
  metaParts.push(place.cost === null || place.cost === undefined ? "人均未知" : "人均 " + formatCost(place.cost));
  if (place.openNow === false) metaParts.push("当前休息");
  metaParts.forEach((label) => {
    const span = document.createElement("span");
    span.textContent = label;
    meta.append(span);
  });

  card.append(head, meta);

  const chips = document.createElement("div");
  chips.className = "chips";
  (Array.isArray(item.reasons) ? item.reasons : []).forEach((reason) => chips.append(chip(reason, "chip")));
  (Array.isArray(item.warnings) ? item.warnings : []).forEach((warning) => chips.append(chip(warning, "chip chip-warn")));
  if (chips.childElementCount) card.append(chips);

  card.addEventListener("click", () => selectPlace(place.id));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPlace(place.id);
    }
  });
  return card;
}

/* ---------- 详情 ---------- */

function showDetail() {
  dom.detail.classList.add("is-open");
  dom.detail.setAttribute("aria-hidden", "false");
}

function hideDetail() {
  dom.detail.classList.remove("is-open");
  dom.detail.setAttribute("aria-hidden", "true");
}

function selectPlace(id) {
  const item = state.ranked.find((entry) => entry.place && entry.place.id === id);
  if (!item) return;
  state.selected = item;
  if (state.map) state.map.clearRoute();
  dom.routeInfo.hidden = true;
  dom.routeInfo.textContent = "";
  renderList();
  renderDetail(item);
  if (state.map) state.map.focus(item.place);
  showDetail();
}

function factRow(label, value, options) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  const opts = options || {};
  if (opts.href) {
    const link = document.createElement("a");
    link.href = opts.href;
    link.textContent = value;
    dd.append(link);
  } else {
    dd.textContent = value;
  }
  return [dt, dd];
}

function renderDetail(item) {
  const place = item.place || {};

  dom.detailName.textContent = text(place.name) || "未命名门店";
  dom.detailName.title = text(place.name);
  dom.detailScore.textContent = scoreText(item.score);
  dom.detailScore.hidden = false;

  const rows = [
    factRow("地址", text(place.address) || "地址未知"),
    factRow("营业时间", text(place.openTime) || "未提供"),
    factRow("评分", place.rating === null || place.rating === undefined ? "暂无评分" : formatRating(place.rating)),
    factRow("人均", place.cost === null || place.cost === undefined ? "消费未知" : formatCost(place.cost)),
    factRow("评论数", place.reviewCount === null || place.reviewCount === undefined ? "暂无" : text(place.reviewCount) + " 条"),
  ];
  const phone = text(place.phone);
  rows.push(factRow("电话", phone || "未提供", phone ? { href: "tel:" + phone } : null));
  dom.detailFacts.replaceChildren(...rows.flat());

  dom.detailReasons.replaceChildren();
  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  if (reasons.length) {
    const chips = document.createElement("div");
    chips.className = "chips";
    reasons.forEach((reason) => chips.append(chip(reason, "chip")));
    dom.detailReasons.append(chips);
  } else {
    const note = document.createElement("p");
    note.className = "empty";
    note.textContent = "按当前偏好没有额外加分项。";
    dom.detailReasons.append(note);
  }

  const warnings = Array.isArray(item.warnings) ? item.warnings : [];
  dom.detailWarnings.replaceChildren();
  dom.detailWarnings.hidden = warnings.length === 0;
  if (warnings.length) {
    const title = document.createElement("strong");
    title.textContent = "注意";
    const chips = document.createElement("div");
    chips.className = "chips";
    warnings.forEach((warning) => chips.append(chip(warning, "chip chip-warn")));
    dom.detailWarnings.append(title, chips);
  }

  const photos = Array.isArray(place.photos) ? place.photos.filter(Boolean) : [];
  dom.detailPhotos.replaceChildren();
  dom.detailPhotos.hidden = photos.length === 0;
  photos.forEach((src) => {
    const img = document.createElement("img");
    img.src = text(src);
    img.alt = (text(place.name) || "门店") + " 照片";
    img.loading = "lazy";
    img.addEventListener("error", () => img.remove());
    dom.detailPhotos.append(img);
  });
}

/* ---------- 路线与导航 ---------- */

async function showRoute() {
  const item = state.selected;
  if (!item || !item.place || !item.place.location) return;
  const from = state.myLocation || state.center;
  const to = item.place.location;

  dom.routeInfo.hidden = false;
  dom.routeInfo.dataset.tone = "info";
  dom.routeInfo.textContent = "正在规划路线…";

  const query =
    "/api/route?from=" + from.lng + "," + from.lat + "&to=" + to.lng + "," + to.lat + "&mode=walking";
  try {
    const data = await getJson(query);
    if (state.map) state.map.drawRoute(Array.isArray(data.path) ? data.path : []);
    const parts = ["步行 " + formatDistance(data.distance), "约 " + formatDuration(data.duration)];
    if (data.source === "mock") parts.push("示意直线");
    dom.routeInfo.dataset.tone = "info";
    dom.routeInfo.textContent = parts.join(" · ");
  } catch (err) {
    dom.routeInfo.dataset.tone = "warn";
    dom.routeInfo.textContent = "路线规划失败：" + messageOf(err);
  }
}

function openNav(kind) {
  const item = state.selected;
  if (!item || !item.place || !item.place.location) return;
  try {
    const url =
      kind === "amap"
        ? amapNavUrl(item.place, { from: state.myLocation || state.center, mode: "walking" })
        : baiduNavUrl(item.place);
    if (url) window.open(url, "_blank", "noopener");
  } catch (err) {
    dom.routeInfo.hidden = false;
    dom.routeInfo.dataset.tone = "warn";
    dom.routeInfo.textContent = "生成导航链接失败：" + messageOf(err);
  }
}

/* ---------- 偏好 ---------- */

function readActivePrefs() {
  try {
    const active = loadActiveProfile();
    if (active && active.prefs && typeof active.prefs === "object") return active.prefs;
  } catch (err) {
    console.warn("[prefs] 读取当前偏好档案失败：", messageOf(err));
  }
  return DEFAULT_PREFS;
}

function looksLikePrefs(value) {
  return (
    value &&
    typeof value === "object" &&
    !(typeof Event !== "undefined" && value instanceof Event) &&
    ("maxDistance" in value || "cuisines" in value || "avoid" in value || "diet" in value)
  );
}

function handlePrefsChange(next) {
  const previousRadius = radiusOf(state.prefs);
  if (looksLikePrefs(next)) state.prefs = next;
  else state.prefs = readActivePrefs();

  // 偏好变化先只重新排序（不重新请求）；半径变了才重新取数。
  renderRanked();
  if (radiusOf(state.prefs) !== previousRadius) void loadPlaces();
}

function mountPrefsPanel() {
  if (typeof renderPrefsPanel !== "function") {
    dom.prefsPanel.textContent = "偏好面板不可用。";
    return;
  }
  try {
    renderPrefsPanel(dom.prefsPanel, { prefs: state.prefs, onChange: handlePrefsChange });
  } catch (err) {
    console.warn("[prefs] 偏好面板渲染失败：", messageOf(err));
    dom.prefsPanel.textContent = "偏好面板初始化失败。";
  }
}

function setPrefsOpen(open) {
  dom.prefsPanel.hidden = !open;
  dom.prefsToggle.setAttribute("aria-expanded", open ? "true" : "false");
  const hint = dom.prefsToggle.querySelector(".pane-toggle-hint");
  if (hint) hint.textContent = open ? "收起" : "展开";
}

/* ---------- 定位 ---------- */

function applyDefaultCenter() {
  state.center = { ...DEFAULT_CENTER };
  state.locationMessage = LOCATION_FAILED;
  renderStatus();
}

function requestLocation() {
  if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") {
    applyDefaultCenter();
    void loadPlaces();
    return;
  }

  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    applyDefaultCenter();
    void loadPlaces();
  }, 8000);

  dom.locate.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      settled = true;
      clearTimeout(timer);
      dom.locate.disabled = false;
      const coords = position && position.coords ? position.coords : null;
      if (!coords) {
        applyDefaultCenter();
        void loadPlaces();
        return;
      }
      state.center = { lng: Number(coords.longitude), lat: Number(coords.latitude) };
      state.myLocation = { ...state.center };
      state.located = true;
      state.locationMessage = "已定位到当前位置";
      renderStatus();
      void loadPlaces();
    },
    (err) => {
      settled = true;
      clearTimeout(timer);
      dom.locate.disabled = false;
      console.warn("[locate] 定位失败：", err && err.code, err && err.message);
      if (!state.located) applyDefaultCenter();
      else {
        state.locationMessage = "重新定位失败，继续使用上一次的位置";
        renderStatus();
      }
      void loadPlaces();
    },
    { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
  );
}

/* ---------- 事件绑定与启动 ---------- */

function wireEvents() {
  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.keyword = dom.input.value.trim();
    void loadPlaces();
  });

  dom.locate.addEventListener("click", () => {
    state.locationMessage = "正在重新定位…";
    renderStatus();
    requestLocation();
  });

  dom.detailClose.addEventListener("click", () => {
    hideDetail();
    state.selected = null;
    if (state.map) state.map.clearRoute();
    renderList();
  });

  dom.routeBtn.addEventListener("click", () => {
    void showRoute();
  });

  dom.navAmap.addEventListener("click", () => openNav("amap"));
  dom.navBaidu.addEventListener("click", () => openNav("baidu"));

  dom.prefsToggle.addEventListener("click", () => setPrefsOpen(dom.prefsPanel.hidden));
}

async function init() {
  wireEvents();

  const wide = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 900px)").matches;
  setPrefsOpen(wide);

  let config = null;
  try {
    config = await getJson("/api/config");
  } catch (err) {
    state.error = "读取配置失败：" + messageOf(err);
  }

  const configuredCenter = config && config.defaultCenter;
  if (configuredCenter && Number.isFinite(configuredCenter.lng) && Number.isFinite(configuredCenter.lat)) {
    DEFAULT_CENTER = { lng: configuredCenter.lng, lat: configuredCenter.lat };
  }

  await setupMap(config);

  state.prefs = readActivePrefs();
  mountPrefsPanel();
  renderStatus();

  requestLocation();
}

void init();
