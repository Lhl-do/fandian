/** 偏好档案状态（localStorage）与偏好面板渲染。 */
import { AVOID_TERMS, CUISINE_TERMS, DIET_TERMS, FLAVOR_TERMS } from "./lexicon.js";

const PREFIX = "fandian:";
const PROFILES_KEY = PREFIX + "profiles";
const ACTIVE_KEY = PREFIX + "active";
const FIRST_PROFILE = "我";
const COMMIT_DELAY = 120;

export const DEFAULT_PREFS = {
  cuisines: [],
  flavors: [],
  avoid: [],
  diet: [],
  maxCost: null,
  minRating: 0,
  maxDistance: 2000,
  openNowOnly: false,
  freeText: "",
};

function safeStorage() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    return localStorage;
  } catch (error) {
    return null;
  }
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

function readNumber(value, fallback) {
  const parsed = typeof value === "number" ? value : Number(String(value === null || value === undefined ? "" : value).trim());
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizePrefsShape(value) {
  const source = value && typeof value === "object" ? value : {};
  const maxCost = source.maxCost === null || source.maxCost === undefined ? null : readNumber(source.maxCost, null);
  return {
    cuisines: textList(source.cuisines),
    flavors: textList(source.flavors),
    avoid: textList(source.avoid),
    diet: textList(source.diet),
    maxCost: maxCost !== null && maxCost > 0 ? maxCost : null,
    minRating: Math.max(0, Math.min(5, readNumber(source.minRating, 0))),
    maxDistance: Math.max(0, readNumber(source.maxDistance, 2000)),
    openNowOnly: source.openNowOnly === true,
    freeText: typeof source.freeText === "string" ? source.freeText : "",
  };
}

function clonePrefs(prefs) {
  return normalizePrefsShape(prefs);
}

function readJson(key) {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (typeof raw !== "string" || !raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeJson(key, value) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* 存储配额不足或隐私模式：忽略，不影响当前会话 */
  }
}

function readActiveName() {
  const storage = safeStorage();
  if (!storage) return "";
  try {
    const raw = storage.getItem(ACTIVE_KEY);
    return typeof raw === "string" ? raw.trim() : "";
  } catch (error) {
    return "";
  }
}

function persistProfiles(list) {
  writeJson(PROFILES_KEY, list);
}

export function loadProfiles() {
  const raw = readJson(PROFILES_KEY);
  const list = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) continue;
      if (list.some((entry) => entry.name === name)) continue;
      list.push({ name: name, prefs: normalizePrefsShape(item.prefs) });
    }
  }
  if (!list.length) {
    list.push({ name: FIRST_PROFILE, prefs: normalizePrefsShape(DEFAULT_PREFS) });
    persistProfiles(list);
  }
  return list;
}

export function saveProfile(name, prefs) {
  const clean = typeof name === "string" ? name.trim() : "";
  const target = clean || FIRST_PROFILE;
  const list = loadProfiles();
  const entry = { name: target, prefs: normalizePrefsShape(prefs) };
  let replaced = false;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].name === target) {
      list[i] = entry;
      replaced = true;
    }
  }
  if (!replaced) list.push(entry);
  persistProfiles(list);
  if (!readActiveName()) {
    const storage = safeStorage();
    if (storage) {
      try {
        storage.setItem(ACTIVE_KEY, target);
      } catch (error) {
        /* 忽略 */
      }
    }
  }
}

export function setActiveProfile(name) {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) return;
  const list = loadProfiles();
  if (!list.some((entry) => entry.name === clean)) return;
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(ACTIVE_KEY, clean);
  } catch (error) {
    /* 忽略 */
  }
}

export function loadActiveProfile() {
  const list = loadProfiles();
  const wanted = readActiveName();
  let found = null;
  for (const entry of list) {
    if (entry.name === wanted) found = entry;
  }
  if (!found) found = list[0];
  if (found.name !== wanted) setActiveProfile(found.name);
  return { name: found.name, prefs: clonePrefs(found.prefs) };
}

/* ---------------- 面板渲染 ---------------- */

function ensureStylesheet(doc) {
  try {
    if (!doc || typeof doc.querySelector !== "function") return;
    if (doc.querySelector('link[href*="prefs.css"]')) return;
    const head = doc.head || doc.documentElement;
    if (!head) return;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/prefs.css";
    head.appendChild(link);
  } catch (error) {
    /* 忽略 */
  }
}

function createEl(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (typeof text === "string" && text) node.textContent = text;
  return node;
}

function toggleValue(list, value) {
  const next = list.slice();
  const index = next.indexOf(value);
  if (index >= 0) next.splice(index, 1);
  else next.push(value);
  return next;
}

function splitTerms(text) {
  const out = [];
  const parts = String(text === null || text === undefined ? "" : text).split(/[\s,，、;；/]+/);
  for (const part of parts) {
    const term = part.trim();
    if (term && out.indexOf(term) < 0) out.push(term);
  }
  return out;
}

function formatMeters(meters) {
  if (meters < 1000) return Math.round(meters) + " 米";
  const km = Math.round((meters / 1000) * 10) / 10;
  return km + " 公里";
}

export function renderPrefsPanel(root, options = {}) {
  if (!root || typeof root.appendChild !== "function") return;
  const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!doc || typeof doc.createElement !== "function") return;
  ensureStylesheet(doc);

  const opts = options && typeof options === "object" ? options : {};
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  const active = loadActiveProfile();
  let activeName = active.name;
  let state = normalizePrefsShape(opts.prefs ? opts.prefs : active.prefs);
  let timer = null;

  const notify = () => {
    if (!onChange) return;
    try {
      onChange(clonePrefs(state));
    } catch (error) {
      /* 回调异常不影响面板 */
    }
  };

  const rerender = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    renderPrefsPanel(root, { prefs: clonePrefs(state), onChange: onChange });
  };

  const flush = (withRerender) => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    saveProfile(activeName, state);
    if (withRerender) {
      rerender();
      return;
    }
    notify();
  };

  const schedule = (delay) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveProfile(activeName, state);
      notify();
    }, typeof delay === "number" ? delay : COMMIT_DELAY);
  };

  const panel = createEl(doc, "div", "fd-prefs");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "口味偏好");

  // 标题 + 档案切换
  const head = createEl(doc, "div", "fd-prefs__head");
  const title = createEl(doc, "h2", "fd-prefs__title", "我的偏好");
  head.appendChild(title);
  const hint = createEl(doc, "p", "fd-prefs__hint", "调好口味与忌口，下面的推荐会立刻重排。");
  head.appendChild(hint);

  const profileBar = createEl(doc, "div", "fd-prefs__profiles");
  const select = createEl(doc, "select", "fd-prefs__select");
  select.setAttribute("aria-label", "选择偏好档案");
  for (const entry of loadProfiles()) {
    const option = createEl(doc, "option", "", entry.name);
    option.value = entry.name;
    if (entry.name === activeName) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const name = select.value;
    setActiveProfile(name);
    const next = loadActiveProfile();
    activeName = next.name;
    state = normalizePrefsShape(next.prefs);
    saveProfile(activeName, state);
    rerender();
    notify();
  });
  profileBar.appendChild(select);

  const nameInput = createEl(doc, "input", "fd-prefs__text");
  nameInput.type = "text";
  nameInput.placeholder = "新档案名";
  nameInput.setAttribute("aria-label", "新档案名");
  profileBar.appendChild(nameInput);

  const saveAsBtn = createEl(doc, "button", "fd-prefs__btn", "另存为");
  saveAsBtn.type = "button";
  saveAsBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    saveProfile(name, state);
    setActiveProfile(name);
    activeName = name;
    nameInput.value = "";
    rerender();
    notify();
  });
  profileBar.appendChild(saveAsBtn);
  head.appendChild(profileBar);
  panel.appendChild(head);

  const body = createEl(doc, "div", "fd-prefs__body");

  const addChipGroup = (label, list, key) => {
    const group = createEl(doc, "section", "fd-prefs__group");
    const rowHead = createEl(doc, "div", "fd-prefs__row");
    rowHead.appendChild(createEl(doc, "h3", "fd-prefs__label", label));
    const count = createEl(doc, "span", "fd-prefs__value", "");
    const syncCount = () => {
      count.textContent = state[key].length ? "已选 " + state[key].length : "";
    };
    rowHead.appendChild(count);
    group.appendChild(rowHead);
    const chips = createEl(doc, "div", "fd-prefs__chips");
    for (const term of list) {
      const chip = createEl(doc, "button", "fd-prefs__chip", term);
      chip.type = "button";
      const sync = () => {
        const on = state[key].indexOf(term) >= 0;
        chip.setAttribute("aria-pressed", on ? "true" : "false");
        if (on) chip.classList.add("is-on");
        else chip.classList.remove("is-on");
      };
      chip.addEventListener("click", () => {
        state[key] = toggleValue(state[key], term);
        sync();
        syncCount();
        schedule(0);
      });
      sync();
      chips.appendChild(chip);
    }
    group.appendChild(chips);
    syncCount();
    body.appendChild(group);
  };

  addChipGroup("想吃什么", CUISINE_TERMS, "cuisines");
  addChipGroup("口味偏好", FLAVOR_TERMS, "flavors");
  addChipGroup("饮食约束", DIET_TERMS, "diet");
  addChipGroup("忌口与过敏", AVOID_TERMS, "avoid");

  // 自定义忌口
  const customGroup = createEl(doc, "section", "fd-prefs__group");
  const customHead = createEl(doc, "div", "fd-prefs__row");
  customHead.appendChild(createEl(doc, "h3", "fd-prefs__label", "其他忌口"));
  customGroup.appendChild(customHead);
  const customWrap = createEl(doc, "div", "fd-prefs__chips");
  const customTerms = state.avoid.filter((term) => AVOID_TERMS.indexOf(term) < 0);
  if (!customTerms.length) {
    customWrap.appendChild(createEl(doc, "span", "fd-prefs__empty", "没有自定义忌口"));
  }
  for (const term of customTerms) {
    const chip = createEl(doc, "button", "fd-prefs__chip fd-prefs__chip--custom", term + " ×");
    chip.type = "button";
    chip.title = "点击删除";
    chip.addEventListener("click", () => {
      state.avoid = state.avoid.filter((item) => item !== term);
      flush(true);
    });
    customWrap.appendChild(chip);
  }
  customGroup.appendChild(customWrap);

  const customRow = createEl(doc, "div", "fd-prefs__input-row");
  const customInput = createEl(doc, "input", "fd-prefs__text");
  customInput.type = "text";
  customInput.placeholder = "输入忌口，如 芒果、冰";
  customInput.setAttribute("aria-label", "自定义忌口");
  const addCustom = () => {
    const terms = splitTerms(customInput.value);
    if (!terms.length) return;
    for (const term of terms) {
      if (state.avoid.indexOf(term) < 0) state.avoid.push(term);
    }
    customInput.value = "";
    flush(true);
  };
  customInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustom();
    }
  });
  customRow.appendChild(customInput);
  const addBtn = createEl(doc, "button", "fd-prefs__btn", "添加");
  addBtn.type = "button";
  addBtn.addEventListener("click", addCustom);
  customRow.appendChild(addBtn);
  customGroup.appendChild(customRow);
  body.appendChild(customGroup);

  // 关键词
  const keywordGroup = createEl(doc, "section", "fd-prefs__group");
  const keywordHead = createEl(doc, "div", "fd-prefs__row");
  keywordHead.appendChild(createEl(doc, "h3", "fd-prefs__label", "补充关键词"));
  keywordGroup.appendChild(keywordHead);
  const keywordInput = createEl(doc, "input", "fd-prefs__text fd-prefs__text--wide");
  keywordInput.type = "text";
  keywordInput.placeholder = "如 老字号、包间、菌汤";
  keywordInput.value = state.freeText;
  keywordInput.setAttribute("aria-label", "补充关键词");
  keywordInput.addEventListener("input", () => {
    state.freeText = keywordInput.value;
    schedule(300);
  });
  keywordGroup.appendChild(keywordInput);
  body.appendChild(keywordGroup);

  const addSlider = (labelText, config) => {
    const group = createEl(doc, "section", "fd-prefs__group fd-prefs__group--slider");
    const rowHead = createEl(doc, "div", "fd-prefs__row");
    rowHead.appendChild(createEl(doc, "h3", "fd-prefs__label", labelText));
    const valueLabel = createEl(doc, "span", "fd-prefs__value", config.format(config.read()));
    rowHead.appendChild(valueLabel);
    group.appendChild(rowHead);
    const range = createEl(doc, "input", "fd-prefs__range");
    range.type = "range";
    range.min = String(config.min);
    range.max = String(config.max);
    range.step = String(config.step);
    range.value = String(config.toSlider(config.read()));
    range.setAttribute("aria-label", labelText);
    range.addEventListener("input", () => {
      const value = config.apply(Number(range.value));
      valueLabel.textContent = config.format(value);
      schedule(COMMIT_DELAY);
    });
    group.appendChild(range);
    body.appendChild(group);
  };

  addSlider("人均预算", {
    min: 0,
    max: 300,
    step: 10,
    read: () => state.maxCost,
    toSlider: (value) => (value === null ? 0 : Math.min(300, value)),
    apply: (value) => {
      state.maxCost = value <= 0 ? null : value;
      return state.maxCost;
    },
    format: (value) => (value === null ? "不限金额" : "人均 ≤ " + value + " 元"),
  });

  addSlider("最低评分", {
    min: 0,
    max: 5,
    step: 0.5,
    read: () => state.minRating,
    toSlider: (value) => value,
    apply: (value) => {
      state.minRating = value;
      return state.minRating;
    },
    format: (value) => (value <= 0 ? "不限评分" : "≥ " + value + " 分"),
  });

  addSlider("最远距离", {
    min: 200,
    max: 5000,
    step: 100,
    read: () => state.maxDistance,
    toSlider: (value) => Math.min(5000, Math.max(200, value)),
    apply: (value) => {
      state.maxDistance = value;
      return state.maxDistance;
    },
    format: (value) => formatMeters(value) + " 以内",
  });

  const switchGroup = createEl(doc, "section", "fd-prefs__group");
  const switchLabel = createEl(doc, "label", "fd-prefs__switch");
  const switchInput = createEl(doc, "input", "fd-prefs__switch-input");
  switchInput.type = "checkbox";
  switchInput.checked = state.openNowOnly === true;
  switchInput.addEventListener("change", () => {
    state.openNowOnly = switchInput.checked === true;
    schedule(0);
  });
  switchLabel.appendChild(switchInput);
  switchLabel.appendChild(createEl(doc, "span", "fd-prefs__switch-track"));
  switchLabel.appendChild(createEl(doc, "span", "fd-prefs__switch-text", "只看正在营业"));
  switchGroup.appendChild(switchLabel);
  body.appendChild(switchGroup);

  const footer = createEl(doc, "div", "fd-prefs__footer");
  const resetBtn = createEl(doc, "button", "fd-prefs__btn fd-prefs__btn--ghost", "重置偏好");
  resetBtn.type = "button";
  resetBtn.addEventListener("click", () => {
    state = normalizePrefsShape(DEFAULT_PREFS);
    flush(true);
  });
  footer.appendChild(resetBtn);
  const saveBtn = createEl(doc, "button", "fd-prefs__btn fd-prefs__btn--primary", "保存到「" + activeName + "」");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", () => {
    flush(false);
    saveBtn.textContent = "已保存";
    saveBtn.classList.add("is-saved");
    setTimeout(() => {
      saveBtn.textContent = "保存到「" + activeName + "」";
      saveBtn.classList.remove("is-saved");
    }, 1400);
  });
  footer.appendChild(saveBtn);
  body.appendChild(footer);

  panel.appendChild(body);
  while (root.firstChild) root.removeChild(root.firstChild);
  root.appendChild(panel);
}
