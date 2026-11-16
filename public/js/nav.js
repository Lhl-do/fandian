/** 导航深链：只拼 URL，不联网、不抛异常。 */

const AMAP_NAV_BASE = "https://uri.amap.com/navigation";
const AMAP_MARKER_BASE = "https://uri.amap.com/marker";
const BAIDU_DIR_BASE = "https://api.map.baidu.com/direction";
const DEFAULT_PLACE_NAME = "该餐厅";
const DEFAULT_ORIGIN_NAME = "我的位置";

function safeText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** encodeURIComponent 之后把组合参数里的分隔符还原成可读字符，其余全部转义。 */
function encodeValue(value) {
  return encodeURIComponent(safeText(value))
    .replace(/%2C/gi, ",")
    .replace(/%3A/gi, ":")
    .replace(/%7C/gi, "|");
}

function buildQuery(pairs) {
  const parts = [];
  for (const pair of pairs) {
    const value = pair[1];
    if (value === null || value === undefined || value === "") continue;
    parts.push(encodeURIComponent(pair[0]) + "=" + encodeValue(value));
  }
  return parts.join("&");
}

function readPlace(place) {
  const target = place && typeof place === "object" ? place : {};
  const location = target.location && typeof target.location === "object" ? target.location : {};
  return {
    name: safeText(target.name).trim() || DEFAULT_PLACE_NAME,
    lng: toNumber(location.lng),
    lat: toNumber(location.lat),
  };
}

/** 起点兼容 {lng,lat}、"lng,lat"、"lng,lat,名称" 三种写法。 */
function readOrigin(from) {
  if (from && typeof from === "object") {
    const lng = toNumber(from.lng);
    const lat = toNumber(from.lat);
    if (lng === null || lat === null) return null;
    return { lng: lng, lat: lat, label: safeText(from.name).trim() || DEFAULT_ORIGIN_NAME };
  }
  const text = safeText(from).trim();
  if (!text) return null;
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(.*))?$/);
  if (!match) return null;
  const label = match[3] && match[3].trim() ? match[3].trim() : DEFAULT_ORIGIN_NAME;
  return { lng: Number(match[1]), lat: Number(match[2]), label: label };
}

function amapMode(mode) {
  const text = safeText(mode).trim().toLowerCase();
  if (text === "driving" || text === "car") return "car";
  if (text === "transit" || text === "bus") return "bus";
  if (text === "riding" || text === "ride") return "ride";
  return "walk";
}

function baiduMode(mode) {
  const text = safeText(mode).trim().toLowerCase();
  if (text === "driving" || text === "car") return "driving";
  if (text === "transit" || text === "bus") return "transit";
  if (text === "riding" || text === "ride") return "riding";
  return "walking";
}

export function amapNavUrl(place, options = {}) {
  try {
    const target = readPlace(place);
    const opts = options && typeof options === "object" ? options : {};
    const origin = readOrigin(opts.from);
    const destination = target.lng !== null && target.lat !== null
      ? target.lng + "," + target.lat + "," + target.name
      : target.name;
    const query = buildQuery([
      ["from", origin ? origin.lng + "," + origin.lat + "," + origin.label : ""],
      ["to", destination],
      ["mode", amapMode(opts.mode)],
      ["policy", "1"],
      ["src", "fandian"],
      ["coordinate", "gaode"],
      ["callnative", "0"],
    ]);
    return AMAP_NAV_BASE + "?" + query;
  } catch (error) {
    return AMAP_NAV_BASE + "?src=fandian&coordinate=gaode";
  }
}

export function baiduNavUrl(place, options = {}) {
  try {
    const target = readPlace(place);
    const opts = options && typeof options === "object" ? options : {};
    const origin = readOrigin(opts.from);
    const destination = target.lng !== null && target.lat !== null
      ? "latlng:" + target.lat + "," + target.lng + "|name:" + target.name
      : "name:" + target.name;
    const query = buildQuery([
      ["origin", origin ? "latlng:" + origin.lat + "," + origin.lng + "|name:" + origin.label : ""],
      ["destination", destination],
      ["mode", baiduMode(opts.mode)],
      ["coord_type", "gcj02"],
      ["output", "html"],
      ["src", "webapp.fandian"],
    ]);
    return BAIDU_DIR_BASE + "?" + query;
  } catch (error) {
    return BAIDU_DIR_BASE + "?coord_type=gcj02&output=html&src=webapp.fandian";
  }
}

export function amapMarkerUrl(place) {
  try {
    const target = readPlace(place);
    const query = buildQuery([
      ["position", target.lng !== null && target.lat !== null ? target.lng + "," + target.lat : ""],
      ["name", target.name],
      ["src", "fandian"],
      ["coordinate", "gaode"],
      ["callnative", "0"],
    ]);
    return AMAP_MARKER_BASE + "?" + query;
  } catch (error) {
    return AMAP_MARKER_BASE + "?src=fandian&coordinate=gaode";
  }
}
