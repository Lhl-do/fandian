/** 推荐引擎打分：纯函数，不碰 DOM、不联网。 */
import {
  AVOID_EXCLUDES,
  AVOID_LEXICON,
  CUISINE_LEXICON,
  DIET_LEXICON,
  FLAVOR_LEXICON,
} from "./lexicon.js";

const HALAL = "清真";
const VEGETARIAN = "素食";
const BASE_SCORE = 38;
const MAX_REASONS = 4;
const MAX_WARNINGS = 4;
const AVOID_PENALTY = 22;
const AVOID_PENALTY_CAP = 44;
const DIET_BONUS = 12;
const CUISINE_BONUS = 16;
const CUISINE_CAP = 28;
const FLAVOR_BONUS = 7;
const FLAVOR_CAP = 14;
const KEYWORD_BONUS = 6;
const KEYWORD_CAP = 12;

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function textList(value) {
  const out = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text && out.indexOf(text) < 0) out.push(text);
  }
  return out;
}

function normalizePrefs(prefs) {
  const source = prefs && typeof prefs === "object" ? prefs : {};
  const maxCost = toNumber(source.maxCost);
  const minRating = toNumber(source.minRating);
  const maxDistance = toNumber(source.maxDistance);
  return {
    cuisines: textList(source.cuisines),
    flavors: textList(source.flavors),
    avoid: textList(source.avoid),
    diet: textList(source.diet),
    maxCost: maxCost !== null && maxCost > 0 ? maxCost : null,
    minRating: minRating !== null && minRating > 0 ? Math.min(5, minRating) : 0,
    maxDistance: maxDistance !== null && maxDistance > 0 ? maxDistance : 0,
    openNowOnly: source.openNowOnly === true,
    freeText: typeof source.freeText === "string" ? source.freeText.trim() : "",
  };
}

function placeText(place) {
  const parts = [];
  const push = (value) => {
    if (typeof value === "string" && value.trim()) parts.push(value);
  };
  push(place.name);
  push(place.type);
  push(place.category);
  if (Array.isArray(place.tags)) {
    for (const tag of place.tags) push(tag);
  }
  return parts.join("｜");
}

function excludedAt(text, index, length, excludes) {
  for (const phrase of excludes) {
    let at = text.indexOf(phrase);
    while (at >= 0) {
      if (index >= at && index + length <= at + phrase.length) return true;
      at = text.indexOf(phrase, at + 1);
    }
  }
  return false;
}

/** 在文本里找第一个命中的关键词，命中处落在排除词里则跳过。 */
function findKeyword(text, keyword) {
  if (!text || !keyword) return false;
  const excludes = AVOID_EXCLUDES[keyword];
  let from = 0;
  for (;;) {
    const index = text.indexOf(keyword, from);
    if (index < 0) return false;
    if (!excludes || !excludedAt(text, index, keyword.length, excludes)) return true;
    from = index + 1;
  }
}

function aliasesFor(term, lexicon) {
  const found = lexicon[term];
  if (Array.isArray(found) && found.length) return found;
  return [term];
}

/** 返回命中的关键词，没有命中返回 null。 */
function findHit(text, aliases) {
  for (const keyword of aliases) {
    if (findKeyword(text, keyword)) return keyword;
  }
  return null;
}

function detectDiet(text) {
  return {
    halal: findHit(text, aliasesFor(HALAL, DIET_LEXICON)) !== null,
    vegetarian: findHit(text, aliasesFor(VEGETARIAN, DIET_LEXICON)) !== null,
  };
}

function formatDistance(meters) {
  if (meters === null) return "距离未知";
  if (meters < 1000) return Math.round(meters) + " 米";
  const km = Math.round(meters / 100) / 10;
  return km + " 公里";
}

function formatNumber(value, digits) {
  const factor = Math.pow(10, digits);
  return String(Math.round(value * factor) / factor);
}

function collect(records, limit) {
  const seen = [];
  const sorted = records.slice().sort((a, b) => b.weight - a.weight);
  const out = [];
  for (const record of sorted) {
    if (out.length >= limit) break;
    if (seen.indexOf(record.text) >= 0) continue;
    seen.push(record.text);
    out.push(record.text);
  }
  return out;
}

function keywordTokens(freeText) {
  if (!freeText) return [];
  const tokens = [];
  const parts = freeText.split(/[\s,，、;；/]+/);
  for (const part of parts) {
    const token = part.trim();
    if (token && tokens.indexOf(token) < 0) tokens.push(token);
  }
  return tokens;
}

export function scorePlace(place, prefs) {
  const target = place && typeof place === "object" ? place : {};
  const options = normalizePrefs(prefs);
  const text = placeText(target);
  const reasons = [];
  const warnings = [];
  const addReason = (weight, value) => reasons.push({ weight: weight, text: value });
  const addWarning = (weight, value) => warnings.push({ weight: weight, text: value });

  const distance = toNumber(target.distance);
  const rating = toNumber(target.rating);
  const cost = toNumber(target.cost);
  const reviews = toNumber(target.reviewCount);
  const openNow = typeof target.openNow === "boolean" ? target.openNow : null;

  // 忌口命中：先算清楚，淘汰时也要一并说明。
  const avoidHits = [];
  let avoidPenalty = 0;
  for (const term of options.avoid) {
    const hit = findHit(text, aliasesFor(term, AVOID_LEXICON));
    if (!hit) continue;
    avoidHits.push({ term: term, hit: hit });
    avoidPenalty += AVOID_PENALTY;
  }

  // 硬过滤：饮食约束与营业状态，命中即淘汰。
  const traits = detectDiet(text);
  const wantHalal = options.diet.some((term) => term === HALAL || term === "halal");
  const wantVeg = options.diet.some((term) => term === VEGETARIAN || term === "吃素");
  const blocked = [];
  let score = BASE_SCORE;
  if (wantHalal) {
    if (traits.halal) {
      score += DIET_BONUS;
      addReason(9.5, "清真餐厅，符合你的饮食约束");
    } else {
      blocked.push("非清真餐厅（你需要清真）");
    }
  }
  if (wantVeg) {
    if (traits.vegetarian) {
      score += DIET_BONUS;
      addReason(9.4, "有素食可选，符合你的饮食约束");
    } else {
      blocked.push("不是素食餐厅（你需要素食）");
    }
  }
  if (options.openNowOnly && openNow === false) {
    blocked.push("当前未营业（你只看营业中）");
  }

  if (blocked.length) {
    const hard = blocked.slice(0, MAX_WARNINGS).map((value, index) => ({ weight: 100 - index, text: value }));
    for (let i = 0; i < avoidHits.length; i += 1) {
      const item = avoidHits[i];
      const detail = item.hit === item.term
        ? "含" + item.term + "（你忌口）"
        : "含" + item.term + "（你忌口，命中「" + item.hit + "」）";
      hard.push({ weight: 60 - i, text: detail });
    }
    return { score: 0, reasons: [], warnings: collect(hard, MAX_WARNINGS) };
  }

  if (avoidPenalty > 0) {
    score -= Math.min(AVOID_PENALTY_CAP, avoidPenalty);
    for (let i = 0; i < avoidHits.length; i += 1) {
      const item = avoidHits[i];
      const detail = item.hit === item.term
        ? "含" + item.term + "（你忌口）"
        : "含" + item.term + "（你忌口，命中「" + item.hit + "」）";
      addWarning(95 - i, detail);
    }
  }

  // 其余饮食约束：能查到就重度扣分（非硬过滤）。
  for (const term of options.diet) {
    if (term === HALAL || term === VEGETARIAN || term === "halal" || term === "吃素") continue;
    const hit = findHit(text, aliasesFor(term, AVOID_LEXICON));
    if (!hit) continue;
    score -= 18;
    addWarning(88, "含" + term + "（饮食约束：" + term + "）");
  }

  // 菜系：权重最高。
  let cuisineScore = 0;
  for (const term of options.cuisines) {
    if (findHit(text, aliasesFor(term, CUISINE_LEXICON)) === null) continue;
    cuisineScore += CUISINE_BONUS;
    addReason(10, "你爱吃" + term);
  }
  if (cuisineScore > 0) score += Math.min(CUISINE_CAP, cuisineScore);

  // 口味。
  let flavorScore = 0;
  for (const term of options.flavors) {
    if (findHit(text, aliasesFor(term, FLAVOR_LEXICON)) === null) continue;
    flavorScore += FLAVOR_BONUS;
    addReason(7, term + "口正合适");
  }
  if (flavorScore > 0) score += Math.min(FLAVOR_CAP, flavorScore);

  // 评分与口碑。
  if (rating !== null) {
    const ratingScore = Math.max(-12, Math.min(9, (rating - 4) * 9));
    score += ratingScore;
    if (rating >= 4.3) addReason(7.5, "评分 " + formatNumber(rating, 1) + " 分，口碑不错");
  }
  if (options.minRating > 0) {
    if (rating === null) {
      score -= 8;
      addWarning(50, "暂无评分，无法确认是否达到 " + formatNumber(options.minRating, 1) + " 分");
    } else if (rating < options.minRating) {
      score -= 25;
      addWarning(80, "评分 " + formatNumber(rating, 1) + " 分，低于你要求的 " + formatNumber(options.minRating, 1) + " 分");
    }
  }
  if (reviews !== null && reviews > 0) {
    score += Math.min(6, Math.log10(reviews + 1) * 2.2);
    if (reviews >= 500) addReason(6, reviews + " 条评论，人气不错");
  }

  // 距离。
  const distanceCap = options.maxDistance > 0 ? options.maxDistance : 3000;
  if (distance !== null) {
    if (options.maxDistance > 0 && distance > options.maxDistance) {
      const overshoot = (distance - options.maxDistance) / options.maxDistance;
      score -= 10 + Math.min(18, overshoot * 18);
      addWarning(62, formatDistance(distance) + "，超出你设的 " + formatDistance(options.maxDistance));
    } else {
      score += Math.max(0, 9 * (1 - distance / distanceCap));
      if (distance <= 1200) addReason(8, "距离 " + formatDistance(distance) + "，走过去就到");
    }
  }

  // 人均。
  if (options.maxCost !== null) {
    if (cost === null) {
      // 未知预算不加不减。
    } else if (cost > options.maxCost) {
      const overshoot = (cost - options.maxCost) / options.maxCost;
      score -= 8 + Math.min(18, overshoot * 20);
      addWarning(58, "人均 " + cost + " 元，超出预算 " + options.maxCost + " 元");
    } else {
      const ratio = cost / options.maxCost;
      score += Math.min(7, 3 + 4 * (1 - ratio));
      addReason(7.2, "人均 " + cost + " 元符合预算");
    }
  }

  if (openNow === true) score += 2;

  // 关键词。
  const tokens = keywordTokens(options.freeText);
  let keywordScore = 0;
  let matchedTokens = 0;
  for (const token of tokens) {
    if (text.indexOf(token) < 0) continue;
    matchedTokens += 1;
    keywordScore += KEYWORD_BONUS;
    addReason(8.5, "符合关键词「" + token + "」");
  }
  if (keywordScore > 0) score += Math.min(KEYWORD_CAP, keywordScore);
  if (tokens.length > 0 && matchedTokens === 0) {
    score -= 5;
    addWarning(30, "没有命中「" + tokens[0] + "」");
  }

  if (!reasons.length) {
    addReason(1, "没有设置偏好，先按口碑和距离推荐");
  }

  const clamped = Math.max(0, Math.min(100, score));
  return {
    score: Math.round(clamped * 10) / 10,
    reasons: collect(reasons, MAX_REASONS),
    warnings: collect(warnings, MAX_WARNINGS),
  };
}

function distanceOf(place) {
  const value = place && typeof place === "object" ? toNumber(place.distance) : null;
  return value === null ? Number.POSITIVE_INFINITY : value;
}

export function rankPlaces(places, prefs) {
  const list = Array.isArray(places) ? places : [];
  const scored = list.map((place) => ({ place: place, ...scorePlace(place, prefs) }));
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return distanceOf(left.place) - distanceOf(right.place);
  });
  return scored;
}
