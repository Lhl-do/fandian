/**
 * 演示数据：20 家门店，菜系分散，评分/人均/评论数/营业时间/标签各不相同。
 * 坐标围绕请求中心点做「确定性极坐标」分布：以 lng/lat 做种子，同一中心点每次结果完全一致；
 * distance 一律由 haversine 依真实坐标算出，保证与 location 自洽。
 */
const DEMO_SHOPS = [
  { name: "蜀香源川菜馆", type: "餐饮服务;中餐厅;四川菜", rating: 4.6, cost: 78, reviewCount: 3241, openTime: "10:30-21:30", tags: ["川菜", "麻辣", "水煮鱼", "花生"] },
  { name: "粤鲜阁点心名家", type: "餐饮服务;中餐厅;粤菜", rating: 4.5, cost: 96, reviewCount: 2140, openTime: "07:00-22:00", tags: ["粤菜", "早茶", "虾饺"] },
  { name: "一期一会日式料理", type: "餐饮服务;外国餐厅;日本料理", rating: 4.7, cost: 168, reviewCount: 1580, openTime: "11:30-22:30", tags: ["日料", "刺身", "清酒"] },
  { name: "首尔部队锅", type: "餐饮服务;外国餐厅;韩国料理", rating: 4.2, cost: 108, reviewCount: 962, openTime: "11:00-次日02:00", tags: ["韩餐", "部队锅", "芝士"] },
  { name: "罗马假日西餐厅", type: "餐饮服务;外国餐厅;西餐厅", rating: 4.4, cost: 145, reviewCount: 762, openTime: "10:00-23:00", tags: ["西餐", "牛排", "意面"] },
  { name: "老王牛肉面", type: "餐饮服务;中餐厅;面馆", rating: 4.6, cost: 26, reviewCount: 1820, openTime: "06:30-次日02:00", tags: ["面食", "汤面", "牛肉", "香菜"] },
  { name: "明净斋素食", type: "餐饮服务;中餐厅;素菜", rating: 4.3, cost: 52, reviewCount: 431, openTime: "07:00-20:30", tags: ["素食", "净素", "菌菇"] },
  { name: "西北清真牛肉拉面", type: "餐饮服务;中餐厅;清真菜", rating: 4.5, cost: 24, reviewCount: 2690, openTime: "00:00-24:00", tags: ["清真", "拉面", "牛肉"] },
  { name: "川渝老火锅", type: "餐饮服务;中餐厅;火锅店", rating: 4.4, cost: 92, reviewCount: 5310, openTime: "11:00-次日03:00", tags: ["火锅", "麻辣", "毛肚"] },
  { name: "炭火江湖烧烤", type: "餐饮服务;中餐厅;烧烤", rating: 4.1, cost: 68, reviewCount: 1183, openTime: "17:00-次日04:00", tags: ["烧烤", "撸串", "炭火"] },
  { name: "拐角咖啡馆", type: "餐饮服务;咖啡厅;咖啡厅", rating: 4.6, cost: 42, reviewCount: 891, openTime: "07:00-20:00", tags: ["咖啡", "手冲", "安静"] },
  { name: "芋圆小站甜品", type: "餐饮服务;糕饼店;甜品店", rating: 4.2, cost: 32, reviewCount: 640, openTime: "10:00-22:00", tags: ["甜品", "芋圆", "港式"] },
  { name: "老街小吃铺", type: "餐饮服务;中餐厅;小吃", rating: 4.0, cost: 18, reviewCount: 1522, openTime: "06:30-次日04:00", tags: ["小吃", "炸物", "夜宵", "花生"] },
  { name: "湘里人家", type: "餐饮服务;中餐厅;湖南菜", rating: 4.3, cost: 74, reviewCount: 1036, openTime: "11:00-22:30", tags: ["湘菜", "剁椒鱼头", "腊味"] },
  { name: "东北铁锅炖", type: "餐饮服务;中餐厅;东北菜", rating: 4.2, cost: 88, reviewCount: 724, openTime: "10:30-次日01:00", tags: ["东北菜", "铁锅炖", "饺子"] },
  { name: "云南小锅米线", type: "餐饮服务;中餐厅;云南菜", rating: 4.4, cost: 34, reviewCount: 968, openTime: "06:30-22:00", tags: ["云南菜", "米线", "菌子", "香菜"] },
  { name: "那不勒斯披萨", type: "餐饮服务;外国餐厅;意大利菜", rating: 4.5, cost: 128, reviewCount: 542, openTime: "11:00-23:00", tags: ["披萨", "意式", "窑烤"] },
  { name: "慢熬粥铺", type: "餐饮服务;中餐厅;粥店", rating: 4.1, cost: 28, reviewCount: 786, openTime: "00:00-24:00", tags: ["粥店", "早餐", "养生"] },
  { name: "素心愿轻食", type: "餐饮服务;中餐厅;素菜", rating: 4.7, cost: 138, reviewCount: 415, openTime: "10:00-20:30", tags: ["素食", "轻食", "沙拉"] },
  { name: "清真宁夏烤羊排", type: "餐饮服务;中餐厅;清真菜", rating: 4.6, cost: 158, reviewCount: 382, openTime: "11:30-次日02:00", tags: ["清真", "烤羊排", "手抓饭", "香菜"] },
];

const STREETS = ["人民路", "解放大道", "建设街", "和平路", "工农路", "中山北路"];
const GOLDEN_ANGLE = 2.399963229728653; // 黄金角，散点分布自然且不重叠
const EARTH_RADIUS = 6371000;

function hashSeed(lng, lat) {
  const lngKey = Math.round(Number(lng) * 10000) | 0;
  const latKey = Math.round(Number(lat) * 10000) | 0;
  let h = Math.imul(lngKey, 73856093) ^ Math.imul(latKey, 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

/** 由种子与下标得到 [0,1) 的确定性伪随机数，不用 Math.random，保证同中心点结果稳定 */
function unit(seed, index) {
  let x = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x27d4eb2d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  return x / 4294967296;
}

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** 极坐标偏移：角度按黄金角递增，半径 240~2240 米，全部落在 radius=3000 的演示范围内 */
function offsetPoint(lng, lat, seed, index) {
  const angle = unit(seed, 0) * Math.PI * 2 + index * GOLDEN_ANGLE;
  const meters = 240 + unit(seed, index + 1) * 2000;
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(latRad), 0.01);
  const dLat = (meters * Math.cos(angle)) / 111320;
  const dLng = (meters * Math.sin(angle)) / (111320 * cosLat);
  return {
    lng: Math.round((lng + dLng) * 1e6) / 1e6,
    lat: Math.round((lat + dLat) * 1e6) / 1e6,
  };
}

/** 由营业时间文案推断此刻是否营业；无法解析时返回 null */
function computeOpenNow(openTime) {
  const m = /(\d{1,2}):(\d{2})\s*-\s*(次日)?\s*(\d{1,2}):(\d{2})/.exec(String(openTime || ""));
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  let end = Number(m[4]) * 60 + Number(m[5]);
  if (m[3]) end += 24 * 60;
  if (end <= start) end += 24 * 60;
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute >= start && minute < end) return true;
  if (end > 24 * 60 && minute + 24 * 60 >= start && minute + 24 * 60 < end) return true;
  return false;
}

function matchesKeyword(shop, category, keyword) {
  const needle = keyword.toLowerCase();
  const haystack = [shop.name, shop.type, category, ...shop.tags].join(" ").toLowerCase();
  return haystack.includes(needle);
}

export function mockPlaces({ lng, lat, radius = 2000, keyword = "", page = 1, limit = 30 } = {}) {
  const centerLng = Number(lng);
  const centerLat = Number(lat);
  if (!Number.isFinite(centerLng) || !Number.isFinite(centerLat)) {
    throw new Error("mockPlaces 需要有效的 lng/lat");
  }
  const center = { lng: centerLng, lat: centerLat };
  const seed = hashSeed(centerLng, centerLat);
  const wantedRadius = Number.isFinite(Number(radius)) && Number(radius) > 0 ? Number(radius) : 2000;
  const wanted = String(keyword || "").trim();

  const all = DEMO_SHOPS.map((shop, index) => {
    const typeParts = shop.type.split(";").filter(Boolean);
    const category = typeParts[typeParts.length - 1];
    const location = offsetPoint(centerLng, centerLat, seed, index);
    return {
      id: "mock-" + (index + 1),
      name: shop.name,
      type: shop.type,
      category,
      address: STREETS[index % STREETS.length] + (100 + index * 7) + " 号",
      location,
      distance: haversine(center, location),
      rating: shop.rating,
      cost: shop.cost,
      reviewCount: shop.reviewCount,
      tags: shop.tags.slice(),
      openNow: computeOpenNow(shop.openTime),
      openTime: shop.openTime,
      phone: "021-" + (65000000 + index * 137577),
      photos: [],
      source: "mock",
    };
  });

  const filtered = all
    .filter((place) => place.distance <= wantedRadius)
    .filter((place) => !wanted || matchesKeyword(place, place.category, wanted))
    .sort((a, b) => a.distance - b.distance);

  const wantedPage = Math.max(Math.round(Number(page) || 1), 1);
  const wantedLimit = Math.max(Math.round(Number(limit) || 30), 1);
  const places = filtered.slice((wantedPage - 1) * wantedLimit, wantedPage * wantedLimit);

  return { source: "mock", center, count: places.length, places };
}
