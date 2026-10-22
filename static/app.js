let STATE = {
  server_info: { ip: "127.0.0.1", port: 8080, url: "http://localhost:8080" },
  shop_settings: {
    shop_name: "MỀM BARKERY",
    shop_phone: "090x.xxx.xxx",
    shop_address: "Tiệm Bánh Ngọt Thủ Công • Since 2026",
    bill_footer: "Cảm ơn quý khách đã ủng hộ Mềm Bakery ❤️",
    paper_size: "k80"
  },
  ingredients: [],
  recipes: [],
  orders: [],
  transactions: [],
  activity_logs: []
};

let currentIngFilter = "all";
let currentPreviewOrder = null;
let selectedTxIds = new Set();
let selectedActIds = new Set();
let currentHistoryViewMode = "all";

const METRIC_FACTORS = {
  mg: 0.001,
  g: 1.0,
  gram: 1.0,
  gr: 1.0,
  ml: 1.0,
  mililit: 1.0,
  "lạng": 100.0,
  kg: 1000.0,
  "ký": 1000.0,
  kilogram: 1000.0,
  "lít": 1000.0,
  lit: 1000.0,
  l: 1000.0
};

function convertUnitFactor(fromUnit, toUnit) {
  const u1 = String(fromUnit || "").trim().toLowerCase();
  const u2 = String(toUnit || "").trim().toLowerCase();
  if (!u1 || !u2 || u1 === u2) return 1.0;
  if (u1 in METRIC_FACTORS && u2 in METRIC_FACTORS) {
    return METRIC_FACTORS[u1] / METRIC_FACTORS[u2];
  }
  return 1.0;
}

function defaultRecipeUnitFor(stockUnit) {
  const u = String(stockUnit || "").trim().toLowerCase();
  if (u in METRIC_FACTORS) return "g";
  return stockUnit || "g";
}

function getCompatibleUnits(stockUnit) {
  const u = String(stockUnit || "").trim().toLowerCase();
  if (u in METRIC_FACTORS) {
    return [
      { value: "g", label: "g (Gram)" },
      { value: "ml", label: "ml (Mililit)" },
      { value: "kg", label: "kg (Kilogram)" },
      { value: "lít", label: "lít (Lít)" },
      { value: "lạng", label: "lạng (100g)" }
    ];
  }
  return [{ value: stockUnit || "cái", label: stockUnit || "cái" }];
}

function formatDualStock(amount, unit) {
  const u = String(unit || "").trim().toLowerCase();
  const main = `${formatNum(amount)} ${unit}`;
  if (u === "kg") {
    return `${main} (${formatNum(amount * 1000)} g)`;
  }
  if (u === "lít" || u === "lit") {
    return `${main} (${formatNum(amount * 1000)} ml)`;
  }
  if (u === "g" && Math.abs(amount) >= 1000) {
    return `${main} (${formatNum(amount / 1000)} kg)`;
  }
  return main;
}

function formatVND(num) {
  const n = Math.round(Number(num) || 0);
  return n.toLocaleString("vi-VN") + " đ";
}

function formatNum(num) {
  const n = Number(num) || 0;
  return Number(n.toFixed(3)).toLocaleString("vi-VN");
}

function showToast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.background = isError ? "#d45b5b" : "#2c4463";
  el.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.classList.add("hidden");
  }, 3200);
}

let IS_VERCEL_STATIC = false;
const LOCAL_STORAGE_KEY = "BAKERY_APP_STATE_V1";
const CLOUD_URL_STORAGE_KEY = "BAKERY_CLOUD_DB_URL_V1";
const DEFAULT_CLOUD_DB_URL = "https://membakery-c7285-default-rtdb.asia-southeast1.firebasedatabase.app";

function normalizeCloudUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/bakery_state\.json$/i, "");
  u = u.replace(/\/\.json$/i, "");
  if (u && !/^https?:\/\//i.test(u)) {
    u = "https://" + u;
  }
  return u;
}

function getCloudDbUrl() {
  let u = localStorage.getItem(CLOUD_URL_STORAGE_KEY);
  if (!u && DEFAULT_CLOUD_DB_URL) {
    u = DEFAULT_CLOUD_DB_URL;
    try {
      localStorage.setItem(CLOUD_URL_STORAGE_KEY, DEFAULT_CLOUD_DB_URL);
    } catch (e) {}
  }
  return normalizeCloudUrl(u || DEFAULT_CLOUD_DB_URL || "");
}

function initCloudFromUrlParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    const cloudParam = params.get("cloud");
    if (cloudParam) {
      const clean = normalizeCloudUrl(cloudParam);
      if (clean) {
        localStorage.setItem(CLOUD_URL_STORAGE_KEY, clean);
      }
      params.delete("cloud");
      const newQuery = params.toString();
      const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
  } catch (e) {}
}
initCloudFromUrlParam();

function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pushLocalActivity(st, action_type, description, now) {
  st.activity_logs = st.activity_logs || [];
  const nextId = st.activity_logs.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  st.activity_logs.unshift({
    id: nextId,
    action_type,
    description,
    created_at: now || nowStr()
  });
}

function recomputeRecipesInState(st) {
  st.transactions = st.transactions || [];
  st.orders = st.orders || [];
  st.activity_logs = st.activity_logs || [];
  if (st.activity_logs.length === 0) {
    st.activity_logs.push({
      id: 1,
      action_type: "SYSTEM",
      description: "Khởi tạo nhật ký thao tác cá nhân trên hệ thống MỀM BARKERY",
      created_at: nowStr()
    });
  }

  const todayPrefix = nowStr().slice(0, 10);
  const ingMap = {};
  (st.ingredients || []).forEach((i) => (ingMap[i.id] = i));

  (st.recipes || []).forEach((r) => {
    let totalBatchCost = 0;
    let maxBatches = null;
    const shortages = [];

    (r.items || []).forEach((it) => {
      const ing = ingMap[it.ingredient_id];
      if (ing) {
        it.ingredient_name = ing.name;
        it.ingredient_unit = ing.unit;
        it.ingredient_stock = Number(ing.stock) || 0;
        it.cost_per_unit = Number(ing.cost_per_unit) || 0;
      }
      const rUnit = it.recipe_unit || it.ingredient_unit || "g";
      const sUnit = it.ingredient_unit || "kg";
      it.recipe_unit = rUnit;
      const factor = convertUnitFactor(rUnit, sUnit);
      const stockNeeded = Number((it.amount * factor).toFixed(6));
      const itemCost = stockNeeded * (it.cost_per_unit || 0);
      it.stock_needed = stockNeeded;
      it.item_cost = Math.round(itemCost * 100) / 100;

      totalBatchCost += itemCost;
      if (stockNeeded > 0) {
        const possible = Math.floor((it.ingredient_stock || 0) / stockNeeded);
        if (maxBatches === null || possible < maxBatches) maxBatches = possible;
        if ((it.ingredient_stock || 0) + 1e-9 < stockNeeded) {
          shortages.push({ ingredient_name: it.ingredient_name });
        }
      }
    });

    let txBakedToday = 0;
    (st.transactions || []).forEach((tx) => {
      if (tx.type === "BAKE" && String(tx.created_at || "").startsWith(todayPrefix)) {
        const titleStr = String(tx.title || "");
        if (titleStr.startsWith("Bán bánh")) return;
        if (Number(tx.recipe_id) === Number(r.id) && Number(tx.baked_qty) > 0) {
          txBakedToday += Number(tx.baked_qty);
        } else if (!tx.recipe_id && titleStr.toLowerCase().includes(String(r.name || "").toLowerCase())) {
          const m = titleStr.match(/\(([\d\.]+)\s+/);
          txBakedToday += m ? parseFloat(m[1]) : Number(r.yield_qty) || 1;
        }
      }
    });

    const manualAdj = r.manual_adj_date === todayPrefix ? Number(r.manual_today_adj) || 0 : 0;
    const bakedToday = Math.max(0, Number((txBakedToday + manualAdj).toFixed(2)));

    let soldToday = 0;
    (st.orders || []).forEach((o) => {
      if (String(o.created_at || "").startsWith(todayPrefix)) {
        (o.items || []).forEach((oit) => {
          if (Number(oit.recipe_id) === Number(r.id)) {
            soldToday += Number(oit.qty) || 0;
          }
        });
      }
    });

    r.total_cost = Math.round(totalBatchCost * 100) / 100;
    const yieldQty = Number(r.yield_qty) || 1;
    r.cost_per_cake = yieldQty > 0 ? Math.round((totalBatchCost / yieldQty) * 100) / 100 : r.total_cost;
    r.max_batches = maxBatches !== null ? maxBatches : 0;
    r.max_cakes = Math.floor(r.max_batches * yieldQty);
    r.shortages = shortages;
    r.tx_baked_today = Number(txBakedToday.toFixed(2));
    r.manual_today_adj = Number(manualAdj.toFixed(2));
    r.baked_today = bakedToday;
    r.sold_today = Number(soldToday.toFixed(2));
    const calcRem = Math.max(0, Number((bakedToday - soldToday).toFixed(2)));
    r.baked_stock = calcRem;
    r.remaining_today = calcRem;
  });

  if (st.server_info) {
    st.server_info.url = window.location.origin;
  }
  return st;
}

async function getLocalVercelState() {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved) {
    try {
      return recomputeRecipesInState(JSON.parse(saved));
    } catch (e) {}
  }
  try {
    const res = await fetch("/initial_state.json");
    if (res.ok) {
      const seed = await res.json();
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(seed));
      return recomputeRecipesInState(seed);
    }
  } catch (e) {}
  return recomputeRecipesInState(STATE);
}

function saveLocalVercelState(st) {
  st.sync_updated_at = Date.now();
  st.sync_time_str = nowStr();
  recomputeRecipesInState(st);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(st));
}

async function fetchStateFromCloud(cloudUrl) {
  const u = normalizeCloudUrl(cloudUrl || getCloudDbUrl());
  if (!u) return null;
  const res = await fetch(`${u}/bakery_state.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Cloud trả về lỗi HTTP ${res.status}. Kiểm tra lại link hoặc chế độ Test Mode trên Firebase.`);
  }
  const data = await res.json();
  if (data && typeof data === "object" && Array.isArray(data.ingredients)) {
    const computed = recomputeRecipesInState(data);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(computed));
    return computed;
  }
  // If Cloud DB is empty (first time), seed it with current local state
  const localSeed = await getLocalVercelState();
  await pushStateToCloud(localSeed, u);
  return localSeed;
}

async function pushStateToCloud(st, cloudUrl) {
  const u = normalizeCloudUrl(cloudUrl || getCloudDbUrl());
  if (!u || !st) return;
  st.sync_updated_at = Date.now();
  st.sync_time_str = nowStr();
  recomputeRecipesInState(st);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(st));
  const res = await fetch(`${u}/bakery_state.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(st)
  });
  if (!res.ok) {
    throw new Error(`Không thể lưu lên Cloud (HTTP ${res.status}). Hãy bật Rules .read/.write = true trên Firebase.`);
  }
}

async function apiGet(url) {
  const cloudUrl = getCloudDbUrl();
  if (cloudUrl) {
    try {
      const cloudData = await fetchStateFromCloud(cloudUrl);
      if (cloudData) return cloudData;
    } catch (err) {
      console.warn("Cloud sync read warning:", err);
    }
  }

  if (!IS_VERCEL_STATIC) {
    try {
      const res = await fetch(url);
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const serverData = await res.json();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serverData));
        return serverData;
      }
      IS_VERCEL_STATIC = true;
    } catch (e) {
      IS_VERCEL_STATIC = true;
    }
  }
  return await getLocalVercelState();
}

async function apiPost(url, payload) {
  const cloudUrl = getCloudDbUrl();
  if (cloudUrl) {
    try {
      await fetchStateFromCloud(cloudUrl);
    } catch (e) {}
    const result = await handleVercelLocalPost(url, payload);
    const updatedSt = await getLocalVercelState();
    await pushStateToCloud(updatedSt, cloudUrl);
    // Also mirror to local server if running locally
    if (!IS_VERCEL_STATIC) {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
    return result;
  }

  if (!IS_VERCEL_STATIC) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.status !== 404 && res.status !== 405) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Có lỗi xảy ra");
        return data;
      }
      IS_VERCEL_STATIC = true;
    } catch (e) {
      if (!IS_VERCEL_STATIC) throw e;
    }
  }
  return await handleVercelLocalPost(url, payload);
}

async function handleVercelLocalPost(path, data) {
  const st = await getLocalVercelState();
  const now = nowStr();

  if (path === "/api/ingredients/save") {
    const name = (data.name || "").trim();
    if (!name) throw new Error("Vui lòng nhập tên nguyên liệu.");
    const pkgSize = Number(data.package_size) || 1;
    const pkgPrice = Number(data.package_price) || 0;
    const costPerUnit = pkgSize > 0 && pkgPrice > 0 ? pkgPrice / pkgSize : Number(data.cost_per_unit) || 0;

    if (data.id) {
      const ing = st.ingredients.find((x) => x.id === Number(data.id));
      if (!ing) throw new Error("Không tìm thấy nguyên liệu.");
      const oldStock = Number(ing.stock) || 0;
      const newStock = Number(data.stock) || 0;
      const diff = Number((newStock - oldStock).toFixed(4));
      ing.name = name;
      ing.category = data.category || "Bột các loại";
      ing.unit = data.unit || "kg";
      ing.stock = newStock;
      ing.min_stock = Number(data.min_stock) || 0;
      ing.package_size = pkgSize;
      ing.package_price = pkgPrice;
      ing.cost_per_unit = costPerUnit;
      ing.updated_at = now;
      if (Math.abs(diff) > 0.0001) {
        const sign = diff > 0 ? "+" : "";
        ing.image_url = data.image_url !== undefined ? (data.image_url || "") : (ing.image_url || "");
        st.transactions.unshift({
          id: Date.now(),
          type: "ADJUST",
          title: `Điều chỉnh tồn kho: ${name}`,
          total_cost: 0,
          created_at: now,
          details: [{ ingredient_id: ing.id, name, change: `${sign}${diff}`, raw_delta: diff, unit: ing.unit }]
        });
      }
      pushLocalActivity(st, "INGREDIENT", `Cập nhật nguyên liệu: ${name} (Tồn: ${newStock} ${ing.unit}, Giá vốn: ${Math.round(costPerUnit).toLocaleString("vi-VN")}đ/${ing.unit})`, now);
    } else {
      const newId = st.ingredients.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
      const stock = Number(data.stock) || 0;
      const unit = data.unit || "kg";
      st.ingredients.push({
        id: newId,
        name,
        category: data.category || "Bột các loại",
        unit,
        stock,
        min_stock: Number(data.min_stock) || 0,
        package_size: pkgSize,
        package_price: pkgPrice,
        cost_per_unit: costPerUnit,
        image_url: data.image_url || "",
        updated_at: now
      });
      st.transactions.unshift({
        id: Date.now(),
        type: "RESTOCK",
        title: `Thêm nguyên liệu mới: ${name}`,
        total_cost: Math.round(stock * costPerUnit),
        created_at: now,
        details: [{ ingredient_id: newId, name, change: `+${stock}`, raw_delta: stock, unit }]
      });
      pushLocalActivity(st, "INGREDIENT", `Thêm nguyên liệu mới: ${name} (${stock} ${unit})`, now);
    }
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/ingredients/update_image") {
    const ing = st.ingredients.find((x) => x.id === Number(data.id));
    if (ing) {
      ing.image_url = data.image_url || "";
      ing.updated_at = now;
      saveLocalVercelState(st);
    }
    return { ok: true, image_url: data.image_url };
  }

  if (path === "/api/recipes/update_image") {
    const r = st.recipes.find((x) => x.id === Number(data.id));
    if (r) {
      r.image_url = data.image_url || "";
      r.updated_at = now;
      saveLocalVercelState(st);
    }
    return { ok: true, image_url: data.image_url };
  }

  if (path === "/api/ingredients/restock") {
    const ing = st.ingredients.find((x) => x.id === Number(data.id));
    if (!ing) throw new Error("Không tìm thấy nguyên liệu.");
    const addQty = Number(data.add_qty) || 0;
    const addUnit = data.add_unit || ing.unit;
    const factor = convertUnitFactor(addUnit, ing.unit);
    const addedInStock = Number((addQty * factor).toFixed(5));
    const totalPrice = Number(data.total_purchase_price) || 0;

    if (totalPrice > 0 && addedInStock > 0) {
      ing.cost_per_unit = ((ing.stock * ing.cost_per_unit) + totalPrice) / (ing.stock + addedInStock);
    }
    ing.stock = Number((ing.stock + addedInStock).toFixed(4));
    ing.updated_at = now;
    const title = `Nhập kho: ${ing.name} (+${addQty}${addUnit})`;
    st.transactions.unshift({
      id: Date.now(),
      type: "RESTOCK",
      title,
      total_cost: Math.round(totalPrice),
      created_at: now,
      details: [{ ingredient_id: ing.id, name: ing.name, change: `+${addQty}${addUnit}`, raw_delta: addedInStock, unit: "" }]
    });
    pushLocalActivity(st, "RESTOCK", title, now);
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/ingredients/delete") {
    const ing = st.ingredients.find((x) => x.id === Number(data.id));
    const ingName = ing ? ing.name : `ID #${data.id}`;
    st.ingredients = st.ingredients.filter((x) => x.id !== Number(data.id));
    pushLocalActivity(st, "INGREDIENT", `Xoá nguyên liệu khỏi kho: ${ingName}`, now);
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/recipes/save") {
    const name = (data.name || "").trim();
    if (!name) throw new Error("Vui lòng nhập tên bánh.");
    const items = (data.items || []).map((it, idx) => ({
      id: idx + 1,
      ingredient_id: Number(it.ingredient_id),
      amount: Number(it.amount),
      recipe_unit: it.recipe_unit || "g"
    }));
    const yieldUnit = data.yield_unit || "bánh";
    const sellingPrice = Number(data.selling_price) || 0;
    const recipeImg = data.image_url || "";
    if (data.id) {
      const r = st.recipes.find((x) => x.id === Number(data.id));
      if (r) {
        Object.assign(r, {
          name,
          category: data.category,
          yield_qty: Number(data.yield_qty) || 1,
          yield_unit: yieldUnit,
          cake_weight_gram: Number(data.cake_weight_gram) || 0,
          selling_price: sellingPrice,
          image_url: recipeImg !== undefined ? (recipeImg || r.image_url || "") : (r.image_url || ""),
          notes: data.notes || "",
          items,
          updated_at: now
        });
      }
      pushLocalActivity(st, "RECIPE", `Cập nhật công thức bánh: ${name} (Giá bán: ${Math.round(sellingPrice).toLocaleString("vi-VN")}đ/${yieldUnit})`, now);
    } else {
      const newId = st.recipes.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
      st.recipes.push({
        id: newId,
        name,
        category: data.category,
        yield_qty: Number(data.yield_qty) || 1,
        yield_unit: yieldUnit,
        cake_weight_gram: Number(data.cake_weight_gram) || 0,
        selling_price: sellingPrice,
        image_url: recipeImg,
        baked_stock: 0,
        notes: data.notes || "",
        items,
        updated_at: now
      });
      pushLocalActivity(st, "RECIPE", `Tạo công thức bánh mới: ${name} (Giá bán: ${Math.round(sellingPrice).toLocaleString("vi-VN")}đ/${yieldUnit})`, now);
    }
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/recipes/delete") {
    const r = st.recipes.find((x) => x.id === Number(data.id));
    const recName = r ? r.name : `ID #${data.id}`;
    st.recipes = st.recipes.filter((x) => x.id !== Number(data.id));
    pushLocalActivity(st, "RECIPE", `Xoá công thức bánh: ${recName}`, now);
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/bake") {
    const rawItems = Array.isArray(data.items) && data.items.length > 0
      ? data.items
      : (data.recipe_id ? [{ recipe_id: data.recipe_id, batches: data.batches }] : []);

    if (rawItems.length === 0) throw new Error("Vui lòng chọn ít nhất 1 loại bánh để làm.");

    const bakePlans = [];
    const ingNeeds = {};

    rawItems.forEach((it) => {
      const r = st.recipes.find((x) => x.id === Number(it.recipe_id));
      if (!r) return;
      const batches = Math.max(0, Number(it.batches) || 1);
      const totalYield = Number((batches * (Number(r.yield_qty) || 1)).toFixed(2));
      bakePlans.push({ recipe: r, batches, yield: totalYield });

      (r.items || []).forEach((ri) => {
        const ing = st.ingredients.find((x) => x.id === Number(ri.ingredient_id));
        if (!ing) return;
        const rUnit = ri.recipe_unit || ing.unit;
        const sUnit = ing.unit;
        const factor = convertUnitFactor(rUnit, sUnit);
        const neededRec = Number((ri.amount * batches).toFixed(2));
        const neededStock = Number((neededRec * factor).toFixed(5));

        if (!ingNeeds[ing.id]) {
          ingNeeds[ing.id] = {
            ing,
            totalNeededStock: 0,
            breakdown: []
          };
        }
        ingNeeds[ing.id].totalNeededStock = Number((ingNeeds[ing.id].totalNeededStock + neededStock).toFixed(5));
        ingNeeds[ing.id].breakdown.push(`${r.name}: -${neededRec}${rUnit}`);
      });
    });

    if (bakePlans.length === 0) throw new Error("Không tìm thấy công thức bánh hợp lệ.");

    const shortages = [];
    Object.values(ingNeeds).forEach((item) => {
      if (item.ing.stock + 1e-9 < item.totalNeededStock) {
        shortages.push(`${item.ing.name} (cần ${item.totalNeededStock} ${item.ing.unit}, kho còn ${item.ing.stock} ${item.ing.unit})`);
      }
    });

    if (shortages.length > 0 && !data.allow_negative) {
      throw new Error("Không đủ nguyên liệu trong kho để làm bánh:\n- " + shortages.join("\n- "));
    }

    const details = [];
    let grandCost = 0;

    Object.values(ingNeeds).forEach((item) => {
      const ing = item.ing;
      const neededStock = item.totalNeededStock;
      const newStock = Number((data.allow_negative ? (ing.stock - neededStock) : Math.max(0, ing.stock - neededStock)).toFixed(4));
      const actualDeducted = Number((ing.stock - newStock).toFixed(5));
      grandCost += neededStock * ing.cost_per_unit;
      ing.stock = newStock;

      details.push({
        ingredient_id: ing.id,
        name: ing.name,
        change: `-${neededStock}${ing.unit} (${item.breakdown.join(" | ")})`,
        raw_delta: -actualDeducted,
        unit: ing.unit,
        after_stock: newStock
      });
    });

    const bakedTitles = [];
    bakePlans.forEach((bp) => {
      bp.recipe.baked_stock = Number(((Number(bp.recipe.baked_stock) || 0) + bp.yield).toFixed(2));
      bakedTitles.push(`${bp.recipe.name} (${bp.yield} ${bp.recipe.yield_unit})`);
    });

    const summaryTitle = `Làm ${bakePlans.length} loại bánh: ` + bakedTitles.join(", ");
    const finalTitle = data.note ? `${summaryTitle} - ${data.note}` : summaryTitle;

    st.transactions.unshift({
      id: Date.now(),
      type: "BAKE",
      title: finalTitle,
      total_cost: Math.round(grandCost),
      recipe_id: bakePlans.length === 1 ? bakePlans[0].recipe.id : null,
      baked_qty: bakePlans.length === 1 ? bakePlans[0].yield : 0,
      created_at: now,
      details
    });

    pushLocalActivity(st, "BAKE", `${finalTitle} — Đã cộng bánh vào quầy bán & trừ nguyên liệu kho`, now);
    saveLocalVercelState(st);
    return { ok: true, title: finalTitle };
  }

  if (path === "/api/orders/create") {
    const customer_name = (data.customer_name || "").trim() || "Khách lẻ";
    const items = data.items || [];
    let subtotal = 0;
    let totalCost = 0;
    const details = [];

    items.forEach((it) => {
      subtotal += it.line_total || 0;
      totalCost += (it.qty || 0) * (it.unit_cost || 0);
      if (it.recipe_id) {
        const r = st.recipes.find((x) => x.id === Number(it.recipe_id));
        if (r) {
          r.baked_stock = Math.max(0, Number(((Number(r.baked_stock) || 0) - (Number(it.qty) || 0)).toFixed(2)));
        }
      }
      if (data.deduct_stock && it.recipe_id) {
        const r = st.recipes.find((x) => x.id === Number(it.recipe_id));
        if (r) {
          const batches = (it.qty || 1) / (r.yield_qty || 1);
          r.items.forEach((ri) => {
            const ing = st.ingredients.find((x) => x.id === Number(ri.ingredient_id));
            if (!ing) return;
            const rUnit = ri.recipe_unit || ing.unit;
            const factor = convertUnitFactor(rUnit, ing.unit);
            const neededRec = Number((ri.amount * batches).toFixed(2));
            const neededStock = Number((neededRec * factor).toFixed(5));
            const newStock = Number(Math.max(0, ing.stock - neededStock).toFixed(4));
            const actualDeducted = Number((ing.stock - newStock).toFixed(5));
            ing.stock = newStock;
            details.push({
              ingredient_id: ing.id,
              name: ing.name,
              change: `-${neededRec}${rUnit} (-${neededStock}${ing.unit})`,
              raw_delta: -actualDeducted,
              unit: ""
            });
          });
        }
      }
    });

    const txId = Date.now();
    if (data.deduct_stock && details.length > 0) {
      st.transactions.unshift({
        id: txId,
        type: "BAKE",
        title: `Bán bánh (${customer_name})`,
        total_cost: Math.round(totalCost),
        created_at: now,
        details
      });
    }

    const total_amount = Math.max(0, subtotal - (Number(data.discount) || 0) + (Number(data.shipping_fee) || 0));
    const bill_code = `HD-${String((st.orders?.length || 0) + 1).padStart(3, "0")}`;
    const order = {
      id: Date.now() + 1,
      bill_code,
      customer_name,
      customer_phone: data.customer_phone || "",
      customer_note: data.customer_note || "",
      payment_method: data.payment_method || "Tiền mặt",
      items,
      subtotal,
      discount: Number(data.discount) || 0,
      shipping_fee: Number(data.shipping_fee) || 0,
      total_amount,
      total_cost: Math.round(totalCost),
      deducted_stock: data.deduct_stock ? 1 : 0,
      tx_id: data.deduct_stock ? txId : null,
      created_at: now
    };
    st.orders = st.orders || [];
    st.orders.unshift(order);
    const summaryNames = items.map((it) => `${it.qty} ${it.name}`).join(", ");
    pushLocalActivity(st, "ORDER", `Tạo đơn bán bánh ${bill_code} (${customer_name}): ${summaryNames} — Tổng: ${Math.round(total_amount).toLocaleString("vi-VN")}đ`, now);
    saveLocalVercelState(st);
    return { ok: true, order };
  }

  if (path === "/api/orders/delete") {
    const ord = (st.orders || []).find((x) => x.id === Number(data.id));
    if (ord && ord.items) {
      ord.items.forEach((oit) => {
        if (oit.recipe_id) {
          const r = st.recipes.find((x) => x.id === Number(oit.recipe_id));
          if (r) {
            r.baked_stock = Number(((Number(r.baked_stock) || 0) + (Number(oit.qty) || 0)).toFixed(2));
          }
        }
      });
    }
    st.orders = (st.orders || []).filter((x) => x.id !== Number(data.id));
    if (ord) {
      pushLocalActivity(st, "ORDER", `Xoá đơn hàng ${ord.bill_code} (${ord.customer_name})`, now);
    }
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/settings/save") {
    st.shop_settings = Object.assign(st.shop_settings || {}, data);
    pushLocalActivity(st, "SETTINGS", `Cập nhật thông tin cửa hàng trên bill: ${st.shop_settings.shop_name || "MỀM BARKERY"}`, now);
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/recipes/adjust_baked") {
    const r = (st.recipes || []).find((x) => x.id === Number(data.recipe_id));
    if (!r) throw new Error("Không tìm thấy công thức bánh");
    const todayPrefix = now.slice(0, 10);
    let txBakedToday = 0;
    (st.transactions || []).forEach((tx) => {
      if (tx.type === "BAKE" && String(tx.created_at || "").startsWith(todayPrefix)) {
        const titleStr = String(tx.title || "");
        if (titleStr.startsWith("Bán bánh")) return;
        if (Number(tx.recipe_id) === Number(r.id) && Number(tx.baked_qty) > 0) {
          txBakedToday += Number(tx.baked_qty);
        } else if (!tx.recipe_id && titleStr.toLowerCase().includes(String(r.name || "").toLowerCase())) {
          const m = titleStr.match(/\(([\d\.]+)\s+/);
          txBakedToday += m ? parseFloat(m[1]) : Number(r.yield_qty) || 1;
        }
      }
    });
    const curAdj = r.manual_adj_date === todayPrefix ? Number(r.manual_today_adj) || 0 : 0;
    const curBakedToday = Math.max(0, Number((txBakedToday + curAdj).toFixed(2)));
    let newBakedToday = curBakedToday;
    if (data.set_baked_today !== undefined && data.set_baked_today !== null) {
      newBakedToday = Math.max(0, Number(parseFloat(data.set_baked_today).toFixed(2)));
    } else {
      newBakedToday = Math.max(0, Number((curBakedToday + (parseFloat(data.delta) || 0)).toFixed(2)));
    }
    r.manual_today_adj = Number((newBakedToday - txBakedToday).toFixed(2));
    r.manual_adj_date = todayPrefix;
    const diff = Number((newBakedToday - curBakedToday).toFixed(2));
    if (diff !== 0) {
      const signStr = diff > 0 ? `+${diff}` : `${diff}`;
      pushLocalActivity(st, "BAKE", `Chỉnh tay số lượng bánh hôm nay (${r.name}): ${signStr} ${r.yield_unit || "ổ"} (Tổng hôm nay: ${newBakedToday} ${r.yield_unit || "ổ"})`, now);
    }
    saveLocalVercelState(st);
    return { ok: true, baked_today: newBakedToday };
  }

  if (path === "/api/transactions/undo") {
    const tx = st.transactions.find((x) => x.id === Number(data.id));
    if (tx && tx.details) {
      tx.details.forEach((d) => {
        const ing = st.ingredients.find((x) => x.id === Number(d.ingredient_id));
        if (ing && d.raw_delta) {
          ing.stock = Number((ing.stock - Number(d.raw_delta)).toFixed(4));
        }
      });
    }
    if (tx && tx.type === "BAKE" && tx.recipe_id && Number(tx.baked_qty) > 0) {
      const r = st.recipes.find((x) => x.id === Number(tx.recipe_id));
      if (r) {
        r.baked_stock = Math.max(0, Number(((Number(r.baked_stock) || 0) - Number(tx.baked_qty)).toFixed(2)));
      }
    }
    st.transactions = st.transactions.filter((x) => x.id !== Number(data.id));
    if (tx) {
      pushLocalActivity(st, "UNDO", `Hoàn tác giao dịch kho (đã cộng/trừ lại tồn kho): ${tx.title}`, now);
    }
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/transactions/delete") {
    if (data.all) {
      const cnt = (st.transactions || []).length;
      st.transactions = [];
      pushLocalActivity(st, "HISTORY", `Xoá toàn bộ lịch sử biến động kho (${cnt} mục)`, now);
    } else {
      const idSet = new Set((data.ids || []).map((x) => Number(x)));
      st.transactions = (st.transactions || []).filter((x) => !idSet.has(Number(x.id)));
      pushLocalActivity(st, "HISTORY", `Xoá tuỳ chọn ${idSet.size} mục trong lịch sử biến động kho`, now);
    }
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/activity/log") {
    if (data.description) {
      pushLocalActivity(st, data.action_type || "ACTION", data.description, now);
      saveLocalVercelState(st);
    }
    return { ok: true };
  }

  if (path === "/api/activity/delete") {
    if (data.all) {
      st.activity_logs = [];
    } else {
      const idSet = new Set((data.ids || []).map((x) => Number(x)));
      st.activity_logs = (st.activity_logs || []).filter((x) => !idSet.has(Number(x.id)));
    }
    saveLocalVercelState(st);
    return { ok: true };
  }

  return { ok: true };
}

async function logClientActivity(action_type, description) {
  try {
    await apiPost("/api/activity/log", { action_type, description });
    await loadState();
  } catch (e) {}
}

async function loadState() {
  try {
    const prevRecipeId = document.getElementById("bake-recipe-select")?.value;
    STATE = await apiGet("/api/state");
    renderAll(prevRecipeId);
  } catch (err) {
    showToast("Không thể tải dữ liệu: " + err.message, true);
  }
}

function switchTab(tabName) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAll(preserveBakeRecipeId) {
  const lanUrl = STATE.server_info?.url || window.location.origin;
  document.getElementById("sidebar-lan-url").textContent = lanUrl;

  populateCategoryFilterDropdown();
  renderDashboard();
  renderPosTab();
  renderIngredients();
  renderRecipes();
  renderBakeTab(preserveBakeRecipeId);
  renderHistory();
  renderActivityLogs();
  renderCustomerDatabase();
}

function populateCategoryFilterDropdown() {
  const sel = document.getElementById("ing-category-filter");
  if (!sel) return;
  const current = sel.value;
  const cats = Array.from(new Set(STATE.ingredients.map((i) => i.category || "Chung"))).sort();
  sel.innerHTML =
    `<option value="">📂 Tất cả phân loại (${STATE.ingredients.length})</option>` +
    cats.map((c) => `<option value="${escapeHtml(c)}" ${c === current ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");
}

/* ==================== 1. DASHBOARD ==================== */
function renderDashboard() {
  const ings = STATE.ingredients;
  const recipes = STATE.recipes;
  const orders = STATE.orders || [];
  const txs = STATE.transactions;

  const lowIngs = ings.filter((i) => i.stock <= i.min_stock);
  const totalValue = ings.reduce((acc, i) => acc + i.stock * i.cost_per_unit, 0);
  const readyRecipes = recipes.filter((r) => r.max_batches > 0).length;

  const totalSalesRev = orders.reduce((acc, o) => acc + (o.total_amount || 0), 0);
  const totalSalesProfit = orders.reduce((acc, o) => acc + ((o.total_amount || 0) - (o.total_cost || 0)), 0);

  document.getElementById("stat-sales-revenue").textContent = formatVND(totalSalesRev);
  document.getElementById("stat-sales-profit").textContent = `Lãi gộp: ${formatVND(totalSalesProfit)} (${orders.length} đơn)`;

  document.getElementById("stat-total-ing").textContent = ings.length;
  const lowTextEl = document.getElementById("stat-low-ing-text");
  if (lowIngs.length > 0) {
    lowTextEl.innerHTML = `<span class="text-danger">⚠️ ${lowIngs.length} nguyên liệu sắp hết</span>`;
  } else {
    lowTextEl.textContent = "✅ Tất cả đều đủ dùng";
  }

  const navBadge = document.getElementById("nav-low-badge");
  if (lowIngs.length > 0) {
    navBadge.textContent = lowIngs.length;
    navBadge.classList.remove("hidden");
  } else {
    navBadge.classList.add("hidden");
  }

  document.getElementById("stat-inventory-value").textContent = formatVND(totalValue);
  document.getElementById("stat-total-recipes").textContent = recipes.length;
  document.getElementById("stat-ready-recipes").textContent = `${readyRecipes}/${recipes.length} bánh đủ nguyên liệu làm ngay`;

  // Low stock alert section
  const lowSec = document.getElementById("low-stock-section");
  const lowList = document.getElementById("low-stock-list");
  if (lowIngs.length > 0) {
    lowSec.classList.remove("hidden");
    lowList.innerHTML = lowIngs
      .map(
        (i) => `
      <div class="low-stock-item">
        <div>
          <strong>${escapeHtml(i.name)}</strong>
          <div class="muted" style="font-size:12px;">
            Còn: <strong class="text-danger">${formatDualStock(i.stock, i.unit)}</strong> (Mức báo: ${formatNum(i.min_stock)} ${escapeHtml(i.unit)})
          </div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="openRestockModal(${i.id})">+ Mua thêm</button>
      </div>
    `
      )
      .join("");
  } else {
    lowSec.classList.add("hidden");
  }

  // Quick bake/sell list
  const quickContainer = document.getElementById("dashboard-quick-recipes");
  if (recipes.length === 0) {
    quickContainer.innerHTML = `<p class="muted">Chưa có công thức bánh nào. Hãy tạo công thức bánh đầu tiên!</p>`;
  } else {
    quickContainer.innerHTML = recipes
      .map((r) => {
        const canBake = r.max_batches > 0;
        const statusBadge = canBake
          ? `<span class="stock-pill stock-ok">Đủ làm ${r.max_cakes || r.max_batches} ${escapeHtml(r.yield_unit)}</span>`
          : `<span class="stock-pill stock-out">Thiếu NL</span>`;
        const weightBadge = r.cake_weight_gram > 0 ? ` <span class="muted" style="font-weight:500; font-size:13px;">(${formatNum(r.cake_weight_gram)}g/${escapeHtml(r.yield_unit)})</span>` : "";
        const imgUrl = getRecipeImageUrl(r);
        const imgHtml = imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(r.name)}" class="quick-recipe-thumb" />` : "";
        return `
        <div class="quick-recipe-item">
          <div class="pos-cake-cell">
            ${imgHtml}
            <div class="quick-recipe-info">
              <h4>${escapeHtml(r.name)}${weightBadge}</h4>
              <div class="quick-recipe-meta">
                <span class="meta-chunk">Giá bán: <strong class="text-green">${formatVND(r.selling_price)}</strong></span>
                <span class="meta-sep">•</span>
                <span class="meta-chunk">Giá vốn: <strong>${formatVND(r.cost_per_cake)}</strong></span>
                <span class="meta-sep">•</span>
                ${statusBadge}
              </div>
            </div>
          </div>
          <div class="quick-recipe-actions">
            <button type="button" class="btn btn-sm btn-secondary" onclick="jumpToSell(${r.id})">🧾 Bán ngay</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="jumpToBake(${r.id})">🧁 Làm bánh</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  // Recent transactions
  const recentTxContainer = document.getElementById("dashboard-recent-tx");
  const recentTxs = txs.slice(0, 6);
  if (recentTxs.length === 0) {
    recentTxContainer.innerHTML = `<p class="muted">Chưa có giao dịch nào.</p>`;
  } else {
    recentTxContainer.innerHTML = recentTxs.map((tx) => renderTxItemHTML(tx, false)).join("");
  }
}

function selectAndCompressImage(callback, maxWidth = 360, maxHeight = 360, quality = 0.85) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (re) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth || h > maxHeight) {
          if (w > h) {
            h = Math.round((h * maxWidth) / w);
            w = maxWidth;
          } else {
            w = Math.round((w * maxHeight) / h);
            h = maxHeight;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        callback(dataUrl);
      };
      img.onerror = () => showToast("Không thể tải hình ảnh này.", true);
      img.src = re.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function getIngredientDefaultIcon(i) {
  const name = String(i?.name || "").toLowerCase();
  const cat = String(i?.category || "").toLowerCase();

  if (name.includes("trứng") || cat.includes("trứng")) return "🥚";
  if (name.includes("sữa") || name.includes("whipping") || name.includes("topping") || cat.includes("sữa")) return "🥛";
  if (name.includes("bột") || cat.includes("bột")) return "🌾";
  if (name.includes("bơ") || name.includes("cheese") || name.includes("phô mai") || cat.includes("bơ")) return "🧈";
  if (name.includes("đường") || name.includes("mật ong") || cat.includes("đường")) return "🍯";
  if (name.includes("men") || name.includes("muối") || name.includes("baking") || cat.includes("men")) return "🧂";
  if (name.includes("cacao") || name.includes("socola") || name.includes("chocolate") || cat.includes("socola")) return "🍫";
  if (name.includes("vani") || name.includes("matcha") || name.includes("màu") || cat.includes("hương")) return "🌿";
  if (name.includes("mứt") || name.includes("nhân") || cat.includes("nhân")) return "🍓";
  if (name.includes("hạt") || name.includes("hạnh nhân") || cat.includes("hạt")) return "🥜";
  if (name.includes("xúc xích") || name.includes("chà bông") || cat.includes("mặn")) return "🌭";
  if (name.includes("dầu") || cat.includes("dầu")) return "🫙";
  if (name.includes("hộp") || name.includes("túi") || cat.includes("bao bì")) return "📦";
  return "📦";
}

async function triggerChangeRecipeImage(recipeId) {
  const r = (STATE.recipes || []).find((x) => x.id === Number(recipeId));
  if (!r) return;
  selectAndCompressImage(async (dataUrl) => {
    try {
      await apiPost("/api/recipes/update_image", { id: r.id, image_url: dataUrl });
      r.image_url = dataUrl;
      showToast("📸 Đã cập nhật ảnh bánh: " + r.name);
      await loadState();
    } catch (err) {
      showToast(err.message, true);
    }
  }, 400, 400, 0.85);
}

async function triggerChangeIngredientImage(ingId) {
  const ing = (STATE.ingredients || []).find((x) => x.id === Number(ingId));
  if (!ing) return;
  selectAndCompressImage(async (dataUrl) => {
    try {
      await apiPost("/api/ingredients/update_image", { id: ing.id, image_url: dataUrl });
      ing.image_url = dataUrl;
      showToast("📸 Đã cập nhật ảnh nguyên liệu: " + ing.name);
      await loadState();
    } catch (err) {
      showToast(err.message, true);
    }
  }, 280, 280, 0.85);
}

function triggerSelectRecipeModalImage() {
  selectAndCompressImage((dataUrl) => {
    const input = document.getElementById("recipe-image-url");
    const preview = document.getElementById("recipe-modal-img-preview");
    if (input) input.value = dataUrl;
    if (preview) {
      preview.innerHTML = `<img src="${dataUrl}" class="modal-thumb-img" alt="Ảnh bánh" />`;
    }
    showToast("📸 Đã chọn ảnh bánh mới!");
  }, 400, 400, 0.85);
}

function clearRecipeModalImage() {
  const input = document.getElementById("recipe-image-url");
  const preview = document.getElementById("recipe-modal-img-preview");
  if (input) input.value = "";
  if (preview) preview.innerHTML = "🧁";
}

function triggerSelectIngModalImage() {
  selectAndCompressImage((dataUrl) => {
    const input = document.getElementById("ing-image-url");
    const preview = document.getElementById("ing-modal-img-preview");
    if (input) input.value = dataUrl;
    if (preview) {
      preview.innerHTML = `<img src="${dataUrl}" class="modal-thumb-img" alt="Ảnh nguyên liệu" />`;
    }
    showToast("📸 Đã chọn ảnh nguyên liệu mới!");
  }, 280, 280, 0.85);
}

function clearIngModalImage() {
  const input = document.getElementById("ing-image-url");
  const preview = document.getElementById("ing-modal-img-preview");
  if (input) input.value = "";
  if (preview) preview.innerHTML = "🥚";
}

function getRecipeImageUrl(r) {
  if (!r) return "";
  if (r.image_url) return r.image_url;
  if (String(r.name || "").toLowerCase().includes("flan")) return "/flan-gato.png";
  return "";
}

/* ==================== 2. POS (BÁN BÁNH & IN BILL GIẤY) ==================== */
function renderPosTab() {
  const tbody = document.getElementById("pos-cakes-tbody");
  if (!tbody) return;

  // Populate customer suggestions
  const custMap = new Map();
  (STATE.orders || []).forEach((o) => {
    if (o.customer_name && o.customer_name !== "Khách lẻ") {
      custMap.set(o.customer_name, o.customer_phone || "");
    }
  });
  const dl = document.getElementById("customer-suggestions");
  if (dl) {
    dl.innerHTML = Array.from(custMap.entries())
      .map(([name, phone]) => `<option value="${escapeHtml(name)}">${escapeHtml(phone)}</option>`)
      .join("");
  }

  if (STATE.recipes.length === 0) {
    tbody.innerHTML = `<tr class="pos-empty-row"><td class="text-center muted" style="padding:24px; display:block;">Chưa có bánh nào trong danh sách. Hãy tạo bánh ở mục "Công thức & Giá vốn" hoặc bấm "+ Thêm món phụ".</td></tr>`;
  } else {
    tbody.innerHTML = STATE.recipes
      .map((r) => {
        const unitPrice = r.selling_price > 0 ? Math.round(r.selling_price) : Math.round((r.cost_per_cake || r.total_cost) * 2);
        const unitCost = r.cost_per_cake || r.total_cost || 0;
        const imgUrl = getRecipeImageUrl(r);
        const imgHtml = imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(r.name)}" class="pos-cake-thumb" />` : "";

        const bakedToday = Number(r.baked_today) || 0;
        const soldToday = Number(r.sold_today) || 0;
        const remaining = Number(r.remaining_today ?? r.baked_stock) || 0;
        const pillClass = remaining > 0 ? "has-cake" : "no-cake";

        return `
        <div class="pos-item-row" onclick="togglePosRow(event, this)" data-recipe-id="${r.id}" data-name="${escapeHtml(r.name)}" data-unit="${escapeHtml(r.yield_unit)}" data-unit-cost="${unitCost}">
          <div class="pos-cell-main">
            <div class="pos-cake-cell">
              ${imgHtml}
              <div class="pos-cake-info">
                <div class="pos-cake-title-line">
                  <strong class="pos-cake-name">${escapeHtml(r.name)}</strong>
                  <span class="pos-unit-price-tag">${formatVND(unitPrice)}</span>
                  <span class="pos-selected-tag">✓ Đã chọn</span>
                </div>
                <div class="pos-baked-status">
                  <span class="pos-baked-pill ${pillClass}">🧁 Còn: <strong>${formatNum(remaining)}</strong></span>
                  <span class="pos-baked-pill meta-pill">Làm: <strong>${formatNum(bakedToday)}</strong>${soldToday > 0 ? ` • Bán: <strong>${formatNum(soldToday)}</strong>` : ""}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="pos-cell-controls">
            <div class="pos-controls-bar">
              <div class="pos-ctrl-box pos-ctrl-price">
                <span class="pos-ctrl-label">Đơn giá</span>
                <input type="number" class="pos-price-input" value="${unitPrice}" min="0" step="1000" oninput="updatePosSummary()" />
              </div>
              <div class="pos-ctrl-box pos-ctrl-qty">
                <span class="pos-ctrl-label">Số lượng</span>
                <div class="pos-qty-box">
                  <button type="button" class="pos-qty-btn" onclick="stepPosQty(event, this, -1)">−</button>
                  <input type="number" class="pos-qty-input" value="1" min="0.5" step="1" oninput="onPosQtyInput(this)" />
                  <button type="button" class="pos-qty-btn" onclick="stepPosQty(event, this, 1)">+</button>
                </div>
              </div>
              <div class="pos-ctrl-box pos-ctrl-total">
                <span class="pos-ctrl-label">Thành tiền</span>
                <strong class="pos-line-total">0 đ</strong>
              </div>
            </div>
          </div>
        </div>
      `;
      })
      .join("");
  }

  updatePosSummary();
  renderOrdersHistory();
}

function jumpToSell(recipeId) {
  switchTab("pos");
  resetPosForm();
  const row = document.querySelector(`.pos-item-row[data-recipe-id="${recipeId}"]`);
  if (row) {
    row.classList.add("selected-row");
    updatePosSummary();
  }
}

function togglePosRow(event, row) {
  if (event.target.tagName === "INPUT" || event.target.tagName === "BUTTON") return;
  const isSelected = row.classList.toggle("selected-row");
  const qtyInput = row.querySelector(".pos-qty-input");
  if (isSelected && (parseFloat(qtyInput.value) || 0) <= 0) {
    qtyInput.value = 1;
  }
  updatePosSummary();
}

function stepPosQty(event, btn, delta) {
  if (event) event.stopPropagation();
  const row = btn.closest(".pos-item-row");
  if (!row) return;
  const isSelected = row.classList.contains("selected-row");
  const input = row.querySelector(".pos-qty-input");
  let current = parseFloat(input.value) || 0;

  if (!isSelected && delta > 0) {
    row.classList.add("selected-row");
    current = 1;
  } else {
    current = Math.max(0, current + delta);
    if (current === 0) {
      row.classList.remove("selected-row");
      current = 1;
    } else {
      row.classList.add("selected-row");
    }
  }
  input.value = current;
  updatePosSummary();
}

function onPosQtyInput(input) {
  const row = input.closest(".pos-item-row");
  if (!row) return;
  const val = parseFloat(input.value) || 0;
  if (val > 0) {
    row.classList.add("selected-row");
  } else {
    row.classList.remove("selected-row");
  }
  updatePosSummary();
}

function addCustomPosRow() {
  const tbody = document.getElementById("pos-cakes-tbody");
  const tr = document.createElement("div");
  tr.className = "pos-item-row selected-row";
  tr.dataset.recipeId = "";
  tr.dataset.unit = "cái";
  tr.dataset.unitCost = "0";
  tr.setAttribute("onclick", "togglePosRow(event, this)");
  tr.innerHTML = `
    <div class="pos-cell-main">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <input type="text" class="form-control custom-pos-name" placeholder="Nhập tên món phụ (VD: Nến, Hộp quà...)" oninput="updatePosSummary()" style="padding:6px 10px; font-size:13.5px; flex:1; min-width:140px;" />
        <span class="pos-unit-price-tag">15.000 đ</span>
        <span class="pos-selected-tag">✓ Đã chọn</span>
      </div>
    </div>
    <div class="pos-cell-controls">
      <div class="pos-controls-bar">
        <div class="pos-ctrl-box pos-ctrl-price">
          <span class="pos-ctrl-label">Đơn giá</span>
          <input type="number" class="pos-price-input" value="15000" min="0" step="1000" oninput="updatePosSummary()" />
        </div>
        <div class="pos-ctrl-box pos-ctrl-qty">
          <span class="pos-ctrl-label">Số lượng</span>
          <div class="pos-qty-box">
            <button type="button" class="pos-qty-btn" onclick="stepPosQty(event, this, -1)">−</button>
            <input type="number" class="pos-qty-input" value="1" min="1" step="1" oninput="onPosQtyInput(this)" />
            <button type="button" class="pos-qty-btn" onclick="stepPosQty(event, this, 1)">+</button>
          </div>
        </div>
        <div class="pos-ctrl-box pos-ctrl-total">
          <span class="pos-ctrl-label">Thành tiền</span>
          <strong class="pos-line-total">15.000 đ</strong>
        </div>
      </div>
    </div>
  `;
  tbody.appendChild(tr);
  tr.querySelector(".custom-pos-name").focus();
  updatePosSummary();
}

function filterPosRows() {
  const q = (document.getElementById("pos-search-input")?.value || "").toLowerCase().trim();
  document.querySelectorAll("#pos-cakes-tbody .pos-item-row").forEach((row) => {
    const name = (row.dataset.name || row.querySelector(".custom-pos-name")?.value || "").toLowerCase();
    row.style.display = !q || name.includes(q) ? "" : "none";
  });
}

function onCustomerNameInput() {
  const nameVal = document.getElementById("pos-customer-name").value.trim();
  const matchedOrder = (STATE.orders || []).find(
    (o) => o.customer_name && o.customer_name.toLowerCase() === nameVal.toLowerCase() && o.customer_phone
  );
  if (matchedOrder && !document.getElementById("pos-customer-phone").value.trim()) {
    document.getElementById("pos-customer-phone").value = matchedOrder.customer_phone;
  }
}

function collectPosItems() {
  const selected = [];
  document.querySelectorAll("#pos-cakes-tbody .pos-item-row").forEach((row) => {
    const isSelected = row.classList.contains("selected-row");
    const qty = parseFloat(row.querySelector(".pos-qty-input")?.value) || 0;
    const price = parseFloat(row.querySelector(".pos-price-input")?.value) || 0;
    const lineTotalEl = row.querySelector(".pos-line-total");
    const priceTagEl = row.querySelector(".pos-unit-price-tag");
    if (priceTagEl) priceTagEl.textContent = formatVND(price);

    if (isSelected && qty > 0) {
      const lineTotal = Math.round(qty * price);
      if (lineTotalEl) lineTotalEl.textContent = formatVND(lineTotal);

      const recipeId = row.dataset.recipeId ? Number(row.dataset.recipeId) : null;
      const name = row.dataset.name || row.querySelector(".custom-pos-name")?.value?.trim() || "Món thêm";
      const unit = row.dataset.unit || "bánh";
      const unitCost = parseFloat(row.dataset.unitCost) || 0;

      selected.push({
        recipe_id: recipeId,
        name,
        unit,
        qty,
        unit_price: price,
        unit_cost: unitCost,
        line_total: lineTotal
      });
    } else {
      if (lineTotalEl) lineTotalEl.textContent = "0 đ";
    }
  });
  return selected;
}

function updatePosSummary() {
  const items = collectPosItems();
  const subtotal = items.reduce((acc, it) => acc + it.line_total, 0);
  const totalCost = items.reduce((acc, it) => acc + it.qty * it.unit_cost, 0);
  const discount = parseFloat(document.getElementById("pos-discount")?.value) || 0;
  const shipping = parseFloat(document.getElementById("pos-shipping")?.value) || 0;
  const grandTotal = Math.max(0, subtotal - discount + shipping);
  const profit = grandTotal - totalCost;

  const previewEl = document.getElementById("pos-selected-items-text");
  if (items.length === 0) {
    previewEl.innerHTML = `<span class="muted" style="font-size:12.5px;">👉 Hãy bấm chọn bánh ở danh sách bên trái</span>`;
  } else {
    previewEl.innerHTML = `
      <div class="pos-chips-preview">
        ${items.map((it) => `<span class="pos-chip-pill">🧁 <strong>${formatNum(it.qty)}</strong> × ${escapeHtml(it.name)} (${formatVND(it.line_total)})</span>`).join("")}
      </div>
    `;
  }

  document.getElementById("pos-subtotal-val").textContent = formatVND(subtotal);
  const adj = shipping - discount;
  document.getElementById("pos-adj-val").textContent = (adj >= 0 ? "+" : "") + formatVND(adj);
  document.getElementById("pos-total-val").textContent = formatVND(grandTotal);
  document.getElementById("pos-profit-val").innerHTML = `<span>Vốn NL: <strong>${formatVND(totalCost)}</strong></span> • <span>Lãi gộp: <strong class="text-green">${formatVND(profit)}</strong></span>`;
}

function resetPosForm() {
  document.querySelectorAll("#pos-cakes-tbody .pos-item-row").forEach((row) => {
    if (!row.dataset.recipeId) {
      row.remove();
      return;
    }
    row.classList.remove("selected-row");
    row.querySelector(".pos-qty-input").value = 1;
  });
  document.getElementById("pos-customer-name").value = "";
  document.getElementById("pos-customer-phone").value = "";
  document.getElementById("pos-customer-note").value = "";
  document.getElementById("pos-discount").value = 0;
  document.getElementById("pos-shipping").value = 0;
  updatePosSummary();
}

async function submitPosOrder(shouldPrint = true) {
  const items = collectPosItems();
  if (items.length === 0) {
    return showToast("Vui lòng tích chọn ít nhất 1 loại bánh khách mua!", true);
  }

  const customer_name = document.getElementById("pos-customer-name").value.trim() || "Khách lẻ";
  const customer_phone = document.getElementById("pos-customer-phone").value.trim();
  const customer_note = document.getElementById("pos-customer-note").value.trim();
  const payment_method = document.getElementById("pos-payment-method").value;
  const discount = parseFloat(document.getElementById("pos-discount").value) || 0;
  const shipping_fee = parseFloat(document.getElementById("pos-shipping").value) || 0;

  try {
    const res = await apiPost("/api/orders/create", {
      customer_name,
      customer_phone,
      customer_note,
      payment_method,
      discount,
      shipping_fee,
      deduct_stock: false,
      items
    });

    showToast(`🎉 Đã tạo đơn ${res.order.bill_code} cho ${customer_name}!`);
    resetPosForm();
    await loadState();

    if (shouldPrint) {
      openBillPreviewById(res.order.id, true);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

let currentOrderPeriod = "today";
let currentOrderCustomDate = "";
let currentOrderCustomMonth = "";

function setOrderPeriod(period) {
  currentOrderPeriod = period;
  if (period !== "custom-date") {
    currentOrderCustomDate = "";
    const dateInput = document.getElementById("order-filter-date");
    if (dateInput) dateInput.value = "";
  }
  if (period !== "custom-month") {
    currentOrderCustomMonth = "";
    const monthInput = document.getElementById("order-filter-month");
    if (monthInput) monthInput.value = "";
  }

  document.querySelectorAll(".order-period-pills .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.operiod === period);
  });

  renderOrdersHistory();
}

function setOrderCustomDate(val) {
  if (!val) {
    setOrderPeriod("today");
    return;
  }
  currentOrderPeriod = "custom-date";
  currentOrderCustomDate = val;
  currentOrderCustomMonth = "";
  const monthInput = document.getElementById("order-filter-month");
  if (monthInput) monthInput.value = "";

  document.querySelectorAll(".order-period-pills .pill").forEach((btn) => {
    btn.classList.remove("active");
  });

  renderOrdersHistory();
}

function setOrderCustomMonth(val) {
  if (!val) {
    setOrderPeriod("month");
    return;
  }
  currentOrderPeriod = "custom-month";
  currentOrderCustomMonth = val;
  currentOrderCustomDate = "";
  const dateInput = document.getElementById("order-filter-date");
  if (dateInput) dateInput.value = "";

  document.querySelectorAll(".order-period-pills .pill").forEach((btn) => {
    btn.classList.remove("active");
  });

  renderOrdersHistory();
}

function getFilteredOrders() {
  const orders = STATE.orders || [];
  const search = (document.getElementById("order-search-input")?.value || "").toLowerCase().trim();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const thisMonthStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const thisYearStr = `${now.getFullYear()}`;

  return orders.filter((o) => {
    const dt = String(o.created_at || "").trim();
    const orderDate = dt.split(" ")[0] || "";
    const orderMonth = orderDate.slice(0, 7);
    const orderYear = orderDate.slice(0, 4);

    if (currentOrderPeriod === "today" && orderDate !== todayStr) return false;
    if (currentOrderPeriod === "month" && orderMonth !== thisMonthStr) return false;
    if (currentOrderPeriod === "year" && orderYear !== thisYearStr) return false;
    if (currentOrderPeriod === "custom-date" && currentOrderCustomDate && orderDate !== currentOrderCustomDate) return false;
    if (currentOrderPeriod === "custom-month" && currentOrderCustomMonth && orderMonth !== currentOrderCustomMonth) return false;

    if (search) {
      const matchBill = (o.bill_code || "").toLowerCase().includes(search);
      const matchCust = (o.customer_name || "").toLowerCase().includes(search);
      const matchPhone = (o.customer_phone || "").toLowerCase().includes(search);
      const matchItems = (o.items || []).some((it) => (it.name || "").toLowerCase().includes(search));
      if (!matchBill && !matchCust && !matchPhone && !matchItems) return false;
    }

    return true;
  });
}

function renderOrdersHistory() {
  const tbody = document.getElementById("orders-history-tbody");
  if (!tbody) return;

  const filteredOrders = getFilteredOrders();

  // Calculate KPI stats
  let totalRev = 0;
  let totalProfit = 0;
  let totalCakes = 0;

  filteredOrders.forEach((o) => {
    totalRev += Number(o.total_amount) || 0;
    totalProfit += (Number(o.total_amount) || 0) - (Number(o.total_cost) || 0);
    (o.items || []).forEach((it) => {
      totalCakes += Number(it.qty) || 0;
    });
  });

  const countEl = document.getElementById("orders-filtered-count");
  const revEl = document.getElementById("order-kpi-rev");
  const profitEl = document.getElementById("order-kpi-profit");
  const kpiCountEl = document.getElementById("order-kpi-count");
  const cakesEl = document.getElementById("order-kpi-cakes");

  if (countEl) countEl.textContent = filteredOrders.length;
  if (revEl) revEl.textContent = formatVND(totalRev);
  if (profitEl) profitEl.textContent = "+" + formatVND(totalProfit);
  if (kpiCountEl) kpiCountEl.textContent = `${filteredOrders.length} đơn`;
  if (cakesEl) cakesEl.textContent = `${formatNum(totalCakes)} cái`;

  if (filteredOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center muted" style="padding:28px;">Không tìm thấy hóa đơn nào trong khoảng thời gian đã chọn.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredOrders
    .map((o) => {
      const itemsSummary = (o.items || [])
        .map((it) => `<div>• <strong>${formatNum(it.qty)}</strong> × ${escapeHtml(it.name)} (${formatVND(it.line_total)})</div>`)
        .join("");
      const profit = (o.total_amount || 0) - (o.total_cost || 0);

      const dtParts = String(o.created_at || "").split(" ");
      const dateStr = dtParts[0] || "";
      const timeStr = dtParts[1] || "";

      return `
      <tr>
        <td data-label="Mã Bill" class="card-cell-header nowrap-cell">
          <strong>${escapeHtml(o.bill_code)}</strong>
          <div><span class="muted" style="font-size:11.5px;">${escapeHtml(o.payment_method)}</span></div>
        </td>
        <td data-label="Thời gian" class="muted nowrap-cell" style="font-size:13px;">
          <div>${escapeHtml(dateStr)}</div>
          ${timeStr ? `<div style="font-size:11.5px;">🕒 ${escapeHtml(timeStr)}</div>` : ""}
        </td>
        <td data-label="Khách hàng">
          <strong>${escapeHtml(o.customer_name)}</strong>
          ${o.customer_phone ? `<div class="muted" style="font-size:12.5px;">📞 ${escapeHtml(o.customer_phone)}</div>` : ""}
          ${o.customer_note ? `<div class="muted" style="font-size:12px;">📝 ${escapeHtml(o.customer_note)}</div>` : ""}
        </td>
        <td data-label="Bánh đã mua" style="font-size:13px;">
          ${itemsSummary}
        </td>
        <td data-label="Tổng thu" class="text-right nowrap-cell"><strong>${formatVND(o.total_amount)}</strong></td>
        <td data-label="Lợi nhuận" class="text-right nowrap-cell"><strong class="text-green">+${formatVND(profit)}</strong></td>
        <td data-label="Thao tác" class="text-right card-cell-actions nowrap-cell">
          <div class="action-btn-group">
            <button type="button" class="btn btn-sm btn-primary" onclick="openBillPreviewById(${o.id}, false)">🖨️ Xem / In Bill</button>
            <button type="button" class="btn btn-sm btn-danger-ghost" onclick="deleteOrder(${o.id})">Huỷ</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

async function deleteOrder(orderId) {
  const o = (STATE.orders || []).find((x) => x.id === orderId);
  if (!o) return;
  if (!confirm(`Bạn có chắc muốn huỷ hóa đơn ${o.bill_code} của khách "${o.customer_name}"?`)) {
    return;
  }
  try {
    await apiPost("/api/orders/delete", { id: orderId });
    showToast("🗑️ Đã huỷ đơn hàng!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ==================== PAPER RECEIPT PRINTING ==================== */
function buildReceiptHTML(order) {
  const shop = STATE.shop_settings || {};
  const shopName = !shop.shop_name || shop.shop_name === "TIỆM BÁNH HOMEMADE" || shop.shop_name === "MỀM BAKERY" ? "MỀM BARKERY" : shop.shop_name;
  const shopPhone = shop.shop_phone || "";
  const shopAddress = !shop.shop_address || shop.shop_address === "Bếp Bánh Thủ Công - Tươi Mới Mỗi Ngày" ? "Tiệm Bánh Ngọt Thủ Công • Since 2026" : shop.shop_address;
  const footer = !shop.bill_footer || shop.bill_footer.includes("TIỆM BÁNH HOMEMADE") ? "Cảm ơn quý khách đã ủng hộ MỀM BARKERY ❤️" : shop.bill_footer;

  const rowsHtml = (order.items || [])
    .map(
      (it) => `
    <tr class="rcp-item-tr">
      <td class="rcp-td-name">
        <div class="rcp-cake-name">${escapeHtml(it.name)}</div>
        <div class="rcp-cake-calc">${formatNum(it.qty)} ${escapeHtml(it.unit || "cái")} × ${Number(it.unit_price).toLocaleString("vi-VN")} đ</div>
      </td>
      <td class="rcp-td-total">
        ${Number(it.line_total).toLocaleString("vi-VN")} đ
      </td>
    </tr>
  `
    )
    .join("");

  return `
    <div class="rcp-receipt-wrapper">
      <div class="rcp-header">
        <img src="/logo.jpg" alt="MỀM BARKERY" class="rcp-logo" />
        <div class="rcp-shop-name">${escapeHtml(shopName)}</div>
        ${shopAddress ? `<div class="rcp-shop-info">${escapeHtml(shopAddress)}</div>` : ""}
        ${shopPhone ? `<div class="rcp-shop-info">Hotline: ${escapeHtml(shopPhone)}</div>` : ""}
      </div>

      <div class="rcp-line-dashed"></div>

      <div class="rcp-title-box">
        <div class="rcp-title">HÓA ĐƠN BÁN HÀNG</div>
        <div class="rcp-bill-code">Số: <strong>${escapeHtml(order.bill_code)}</strong></div>
      </div>

      <div class="rcp-meta-grid">
        <div class="rcp-meta-row">
          <span class="rcp-meta-k">Thời gian:</span>
          <span class="rcp-meta-v">${escapeHtml(order.created_at)}</span>
        </div>
        <div class="rcp-meta-row">
          <span class="rcp-meta-k">Khách hàng:</span>
          <strong class="rcp-meta-v">${escapeHtml(order.customer_name || "Khách lẻ")}</strong>
        </div>
        ${
          order.customer_phone
            ? `<div class="rcp-meta-row"><span class="rcp-meta-k">Điện thoại:</span><span class="rcp-meta-v">${escapeHtml(order.customer_phone)}</span></div>`
            : ""
        }
        <div class="rcp-meta-row">
          <span class="rcp-meta-k">Thanh toán:</span>
          <span class="rcp-meta-v">${escapeHtml(order.payment_method || "Tiền mặt")}</span>
        </div>
        ${
          order.customer_note
            ? `<div class="rcp-meta-note"><span class="rcp-meta-k">Ghi chú:</span> <span class="rcp-meta-v">${escapeHtml(order.customer_note)}</span></div>`
            : ""
        }
      </div>

      <div class="rcp-line-solid"></div>

      <table class="rcp-table">
        <thead>
          <tr>
            <th class="rcp-th-name">Mặt hàng &amp; SL</th>
            <th class="rcp-th-total">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="rcp-line-solid"></div>

      <div class="rcp-totals">
        <div class="rcp-row">
          <span>Tạm tính tiền bánh:</span>
          <span>${formatVND(order.subtotal)}</span>
        </div>
        ${
          order.discount > 0
            ? `<div class="rcp-row rcp-row-disc"><span>Giảm giá:</span><span>−${formatVND(order.discount)}</span></div>`
            : ""
        }
        ${
          order.shipping_fee > 0
            ? `<div class="rcp-row"><span>Phí giao hàng:</span><span>+${formatVND(order.shipping_fee)}</span></div>`
            : ""
        }
        <div class="rcp-row rcp-grand">
          <span class="rcp-grand-title">TỔNG CỘNG:</span>
          <span class="rcp-grand-price">${formatVND(order.total_amount)}</span>
        </div>
      </div>

      <div class="rcp-line-dashed"></div>

      <div class="rcp-footer">
        <div class="rcp-footer-msg">${escapeHtml(footer)}</div>
        <div class="rcp-sub-bye">Hân hạnh được phục vụ quý khách!</div>
      </div>
    </div>
  `;
}

function openBillPreviewById(orderId, autoPrint = false) {
  const order = (STATE.orders || []).find((x) => x.id === orderId);
  if (!order) return;
  currentPreviewOrder = order;

  const paperSize = STATE.shop_settings?.paper_size || "k80";
  document.getElementById("preview-paper-size").value = paperSize;

  const html = buildReceiptHTML(order);
  const previewBox = document.getElementById("bill-preview-box");
  previewBox.className = `receipt-paper ${paperSize}`;
  previewBox.innerHTML = html;

  const printArea = document.getElementById("print-receipt-area");
  printArea.innerHTML = `<div class="receipt-paper ${paperSize}">${html}</div>`;

  document.getElementById("modal-bill-preview").classList.remove("hidden");

  if (autoPrint) {
    setTimeout(() => {
      window.print();
    }, 300);
  }
}

function changePreviewPaperSize(size) {
  if (!currentPreviewOrder) return;
  const html = buildReceiptHTML(currentPreviewOrder);
  const previewBox = document.getElementById("bill-preview-box");
  previewBox.className = `receipt-paper ${size}`;
  previewBox.innerHTML = html;

  const printArea = document.getElementById("print-receipt-area");
  printArea.innerHTML = `<div class="receipt-paper ${size}">${html}</div>`;
}

function triggerBrowserPrint() {
  if (currentPreviewOrder) {
    logClientActivity(
      "ORDER",
      `In bill giấy đơn hàng ${currentPreviewOrder.bill_code} (${currentPreviewOrder.customer_name || "Khách lẻ"})`
    );
  }
  window.print();
}

function openShopSettingsModal() {
  const s = STATE.shop_settings || {};
  document.getElementById("setting-shop-name").value = s.shop_name || "TIỆM BÁNH HOMEMADE";
  document.getElementById("setting-shop-phone").value = s.shop_phone || "";
  document.getElementById("setting-shop-address").value = s.shop_address || "";
  document.getElementById("setting-bill-footer").value = s.bill_footer || "";
  document.getElementById("setting-paper-size").value = s.paper_size || "k80";
  document.getElementById("modal-shop-settings").classList.remove("hidden");
}

async function saveShopSettings() {
  const shop_name = document.getElementById("setting-shop-name").value.trim();
  const shop_phone = document.getElementById("setting-shop-phone").value.trim();
  const shop_address = document.getElementById("setting-shop-address").value.trim();
  const bill_footer = document.getElementById("setting-bill-footer").value.trim();
  const paper_size = document.getElementById("setting-paper-size").value;

  try {
    await apiPost("/api/settings/save", {
      shop_name,
      shop_phone,
      shop_address,
      bill_footer,
      paper_size
    });
    closeModal("modal-shop-settings");
    showToast("✅ Đã lưu thông tin tiệm bánh in trên Bill!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ==================== 3. BAKE TAB (MULTI-CAKE AUTO DEDUCTION) ==================== */
let BAKE_SELECTIONS = {}; // { [recipeId]: batches }

function clearAllBakeSelections() {
  BAKE_SELECTIONS = {};
  renderBakeTab();
  showToast("🔄 Đã đặt số lượng làm tất cả các bánh về 0.");
}

function selectAllBake1Batch() {
  (STATE.recipes || []).forEach((r) => {
    BAKE_SELECTIONS[r.id] = 1;
  });
  renderBakeTab();
  showToast("🧁 Đã chọn làm 1 mẻ cho tất cả các loại bánh.");
}

function filterBakeRecipes() {
  const q = (document.getElementById("bake-search-input")?.value || "").toLowerCase().trim();
  document.querySelectorAll(".bake-recipe-row").forEach((row) => {
    const name = row.dataset.name || "";
    row.style.display = !q || name.includes(q) ? "" : "none";
  });
}

function stepBakeQty(recipeId, delta) {
  const current = BAKE_SELECTIONS[recipeId] || 0;
  const next = Math.max(0, Math.round((current + delta) * 10) / 10);
  if (next <= 0) {
    delete BAKE_SELECTIONS[recipeId];
  } else {
    BAKE_SELECTIONS[recipeId] = next;
  }
  renderBakeTab();
}

function setBakeQty(recipeId, val) {
  const next = Math.max(0, parseFloat(val) || 0);
  if (next <= 0) {
    delete BAKE_SELECTIONS[recipeId];
  } else {
    BAKE_SELECTIONS[recipeId] = next;
  }
  renderBakeTab();
}

function removeBakeSelection(recipeId) {
  delete BAKE_SELECTIONS[recipeId];
  renderBakeTab();
}

function jumpToBake(recipeId) {
  switchTab("bake");
  BAKE_SELECTIONS = { [Number(recipeId)]: 1 };
  renderBakeTab();
  const searchInput = document.getElementById("bake-search-input");
  if (searchInput) searchInput.value = "";
  const el = document.getElementById(`bake-row-${recipeId}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderBakeTab() {
  renderBakeDailySummary();
  const listEl = document.getElementById("bake-recipes-list");
  if (!listEl) return;

  const recipes = STATE.recipes || [];
  if (recipes.length === 0) {
    listEl.innerHTML = `<p class="muted text-center" style="padding: 24px;">Chưa có công thức bánh nào. Vui lòng tạo công thức ở mục "Công thức".</p>`;
    renderBakePreview();
    return;
  }

  const q = (document.getElementById("bake-search-input")?.value || "").toLowerCase().trim();

  listEl.innerHTML = recipes
    .map((r) => {
      const batches = BAKE_SELECTIONS[r.id] || 0;
      const isSelected = batches > 0;
      const unit = escapeHtml(r.yield_unit || "bánh");
      const yieldQty = Number(r.yield_qty) || 1;
      const totalYield = Math.round(batches * yieldQty * 10) / 10;
      const imgUrl = getRecipeImageUrl(r);
      const imgHtml = imgUrl
        ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(r.name)}" class="bake-cake-thumb" />`
        : `<div class="bake-cake-thumb" style="display:flex; align-items:center; justify-content:center; font-size:22px;">🧁</div>`;

      const unitCost = r.cost_per_cake || (r.total_cost && yieldQty ? r.total_cost / yieldQty : 0);
      const sellPrice = Number(r.selling_price) || 0;
      const remStock = Number(r.remaining_today !== undefined ? r.remaining_today : r.baked_stock) || 0;

      let subYieldInfo = `1 mẻ = ${yieldQty} ${unit}`;
      if (r.cake_weight_gram > 0) subYieldInfo += ` (${formatNum(r.cake_weight_gram)}g)`;

      let selectedSubText = "";
      if (isSelected) {
        selectedSubText = `<div class="bake-selected-subtext">👉 Đang chọn: <strong>${formatNum(batches)} mẻ</strong> (= ${formatNum(totalYield)} ${unit}) • Vốn mẻ: ${formatVND(batches * (r.total_cost || 0))}</div>`;
      }

      return `
      <div class="bake-recipe-row ${isSelected ? "is-selected" : ""}" id="bake-row-${r.id}" data-name="${escapeHtml(r.name.toLowerCase())}">
        <div class="bake-cake-info">
          <div class="bake-cake-thumb-wrap" onclick="triggerChangeRecipeImage(${r.id})" title="Bấm để tải/đổi ảnh bánh">
            ${imgHtml}
            <span class="thumb-cam-badge">📷 Đổi ảnh</span>
          </div>
          <div class="bake-cake-texts">
            <div class="bake-cake-title">
              <span class="bake-cake-name-text">${escapeHtml(r.name)}</span>
              ${isSelected ? `<span class="bake-selected-badge">✓ Làm ${formatNum(batches)} mẻ</span>` : ""}
            </div>
            <div class="bake-cake-meta-row">
              <span class="bake-meta-pill">📋 ${subYieldInfo}</span>
              <span class="bake-meta-pill">💰 ${formatVND(sellPrice)}</span>
              <span class="bake-meta-pill ${remStock > 0 ? "has-stock" : "no-stock"}">📦 Còn: <strong>${formatNum(remStock)}</strong> ${unit}</span>
            </div>
            ${selectedSubText}
          </div>
        </div>

        <div class="bake-stepper-compact">
          <button type="button" class="bake-btn-step bake-minus" onclick="stepBakeQty(${r.id}, -1)" title="Giảm 1 mẻ">−</button>
          <input
            type="number"
            class="bake-compact-input"
            min="0"
            step="0.5"
            value="${batches > 0 ? batches : 0}"
            onchange="setBakeQty(${r.id}, this.value)"
            title="Nhập số mẻ làm"
          />
          <button type="button" class="bake-btn-step bake-plus" onclick="stepBakeQty(${r.id}, 1)" title="Tăng 1 mẻ">+</button>
          <button type="button" class="bake-btn-quick" onclick="stepBakeQty(${r.id}, 5)" title="Tăng 5 mẻ">+5</button>
          ${batches > 0 ? `<button type="button" class="bake-btn-reset" onclick="setBakeQty(${r.id}, 0)" title="Xoá chọn">✕</button>` : ""}
        </div>
      </div>
    `;
    })
    .join("");

  if (q) filterBakeRecipes();
  renderBakePreview();
}

function renderBakeDailySummary() {
  const tbody = document.getElementById("bake-daily-summary-tbody");
  if (!tbody) return;
  const totalBakedEl = document.getElementById("total-baked-today-val");
  const totalSoldEl = document.getElementById("total-sold-today-val");
  const totalRemEl = document.getElementById("total-remaining-today-val");

  const recipes = STATE.recipes || [];
  let sumBaked = 0;
  let sumSold = 0;
  let sumRem = 0;

  recipes.forEach((r) => {
    sumBaked += Number(r.baked_today) || 0;
    sumSold += Number(r.sold_today) || 0;
    sumRem += Number(r.remaining_today !== undefined ? r.remaining_today : r.baked_stock) || 0;
  });

  if (totalBakedEl) totalBakedEl.textContent = formatNum(sumBaked);
  if (totalSoldEl) totalSoldEl.textContent = formatNum(sumSold);
  if (totalRemEl) totalRemEl.textContent = formatNum(sumRem);

  if (recipes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;">Chưa có công thức bánh nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = recipes
    .map((r) => {
      const unit = escapeHtml(r.yield_unit || "ổ");
      const bakedToday = Number(r.baked_today) || 0;
      const soldToday = Number(r.sold_today) || 0;
      const remToday = Number(r.remaining_today !== undefined ? r.remaining_today : r.baked_stock) || 0;
      const txBaked = Number(r.tx_baked_today) || 0;
      const manualAdj = Number(r.manual_today_adj) || 0;

      const subNote =
        manualAdj !== 0
          ? `<div style="font-size:0.74rem; color:#8d5b4c; margin-top:2px;">Nấu trừ kho: ${formatNum(txBaked)} ${unit} • Chỉnh tay: ${manualAdj > 0 ? "+" : ""}${formatNum(manualAdj)} ${unit}</div>`
          : txBaked > 0
            ? `<div style="font-size:0.74rem; color:#2e7d32; margin-top:2px;">Nấu từ trừ kho: ${formatNum(txBaked)} ${unit}</div>`
            : "";

      const remBadgeColor = remToday > 0 ? "background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7;" : "background:#fff3e0; color:#e65100; border:1px solid #ffcc80;";

      return `
        <tr>
          <td data-label="Tên loại bánh" class="card-cell-header">
            <div style="font-weight:700; color:var(--text);">🧁 ${escapeHtml(r.name)}</div>
            ${subNote}
          </td>
          <td data-label="Đã làm hôm nay" class="nowrap-cell" style="text-align:center;">
            <span style="font-weight:800; font-size:0.9rem; color:#39557a; background:#eaf1fb; border:1px solid #d5e3f5; padding:4px 10px; border-radius:999px; display:inline-block; white-space:nowrap;">
              ${formatNum(bakedToday)} ${unit}
            </span>
          </td>
          <td data-label="Đã bán hôm nay" class="nowrap-cell" style="text-align:center;">
            <span style="font-weight:700; font-size:0.9rem; color:var(--text-muted); white-space:nowrap;">
              ${formatNum(soldToday)} ${unit}
            </span>
          </td>
          <td data-label="Còn lại trong ngày" class="nowrap-cell" style="text-align:center;">
            <span style="font-weight:800; font-size:0.9rem; padding:4px 10px; border-radius:999px; display:inline-block; white-space:nowrap; ${remBadgeColor}">
              ${formatNum(remToday)} ${unit}
            </span>
          </td>
          <td data-label="Cộng / Trừ thủ công" class="card-cell-actions nowrap-cell" style="text-align:center;">
            <div class="daily-adj-controls">
              <button type="button" class="btn btn-outline btn-xs" onclick="adjustDailyBaked(${r.id}, -1)" title="Trừ bớt 1 ${unit}">−1</button>
              <input
                type="number"
                class="daily-adj-input"
                min="0"
                step="1"
                value="${bakedToday}"
                onchange="setDailyBaked(${r.id}, this.value)"
                title="Nhập trực tiếp tổng số lượng đã làm hôm nay"
              />
              <button type="button" class="btn btn-outline btn-xs" onclick="adjustDailyBaked(${r.id}, 1)" title="Cộng thêm 1 ${unit}">+1</button>
              <button type="button" class="btn btn-secondary btn-xs" onclick="adjustDailyBaked(${r.id}, 5)" title="Cộng thêm 5 ${unit}">+5</button>
              <button type="button" class="btn btn-danger btn-xs" onclick="setDailyBaked(${r.id}, 0)" title="Đặt về 0" ${bakedToday <= 0 ? "disabled" : ""}>Về 0</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function adjustDailyBaked(recipeId, delta) {
  try {
    await apiPost("/api/recipes/adjust_baked", {
      recipe_id: Number(recipeId),
      delta: Number(delta)
    });
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function setDailyBaked(recipeId, val) {
  const num = Math.max(0, parseFloat(val) || 0);
  try {
    await apiPost("/api/recipes/adjust_baked", {
      recipe_id: Number(recipeId),
      set_baked_today: num
    });
    showToast("✅ Đã cập nhật số lượng bánh hôm nay!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderBakePreview() {
  const summaryBox = document.getElementById("bake-selected-summary-box");
  const previewEl = document.getElementById("bake-ingredients-preview");
  const warningEl = document.getElementById("bake-shortage-warning");
  const shortageListEl = document.getElementById("bake-shortage-list");
  const submitBtn = document.getElementById("btn-submit-bake");

  const selectedEntries = Object.entries(BAKE_SELECTIONS).filter(([id, b]) => Number(b) > 0);

  if (selectedEntries.length === 0) {
    if (summaryBox) {
      summaryBox.innerHTML = `<span class="muted">Chưa chọn loại bánh nào. Hãy bấm <strong>+1</strong> ở danh sách bên trái để chọn bánh bạn làm hôm nay.</span>`;
    }
    if (previewEl) {
      previewEl.innerHTML = `<p class="muted text-center" style="padding: 20px;">Nguyên liệu cần trừ sẽ hiển thị tự động khi bạn chọn bánh bên trái.</p>`;
    }
    if (warningEl) warningEl.classList.add("hidden");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "🧁 Hãy chọn ít nhất 1 loại bánh để làm";
    }

    const cakesCountEl = document.getElementById("bake-total-cakes-count");
    const totalCostEl = document.getElementById("bake-total-cost");
    const expectedRevEl = document.getElementById("bake-expected-rev");
    const expectedProfitEl = document.getElementById("bake-expected-profit");

    if (cakesCountEl) cakesCountEl.textContent = "0 cái (0 loại bánh)";
    if (totalCostEl) totalCostEl.textContent = "0 đ";
    if (expectedRevEl) expectedRevEl.textContent = "0 đ";
    if (expectedProfitEl) expectedProfitEl.textContent = "0 đ";
    return;
  }

  // Build bake plans
  const bakePlans = [];
  let totalAllCakes = 0;
  let totalGrandCost = 0;
  let totalExpectedRev = 0;

  selectedEntries.forEach(([recId, batches]) => {
    const r = STATE.recipes.find((x) => x.id === Number(recId));
    if (!r) return;
    const b = Number(batches);
    const yieldQty = Number(r.yield_qty) || 1;
    const cakes = Math.round(b * yieldQty * 10) / 10;
    const cost = (r.total_cost || 0) * b;
    const rev = (r.selling_price || 0) * cakes;

    totalAllCakes += cakes;
    totalGrandCost += cost;
    totalExpectedRev += rev;

    bakePlans.push({
      recipe: r,
      batches: b,
      cakes,
      cost,
      rev
    });
  });

  const totalExpectedProfit = totalExpectedRev - totalGrandCost;

  // Render selected chips
  if (summaryBox) {
    const chipsHtml = bakePlans
      .map(
        (bp) => `
        <span class="bake-cake-chip">
          <strong>🧁 ${escapeHtml(bp.recipe.name)}</strong>: ${formatNum(bp.batches)} mẻ (= ${formatNum(bp.cakes)} ${escapeHtml(bp.recipe.yield_unit)})
          <span class="chip-remove" onclick="removeBakeSelection(${bp.recipe.id})" title="Bỏ chọn bánh này">✕</span>
        </span>
      `
      )
      .join("");
    summaryBox.innerHTML = `<div><strong>Đã chọn (${bakePlans.length} loại bánh):</strong></div><div style="margin-top:6px;">${chipsHtml}</div>`;
  }

  // Update cost summary
  const cakesCountEl = document.getElementById("bake-total-cakes-count");
  const totalCostEl = document.getElementById("bake-total-cost");
  const expectedRevEl = document.getElementById("bake-expected-rev");
  const expectedProfitEl = document.getElementById("bake-expected-profit");

  if (cakesCountEl) cakesCountEl.textContent = `${formatNum(totalAllCakes)} cái (${bakePlans.length} loại bánh)`;
  if (totalCostEl) totalCostEl.textContent = formatVND(totalGrandCost);
  if (expectedRevEl) expectedRevEl.textContent = formatVND(totalExpectedRev);
  if (expectedProfitEl) expectedProfitEl.textContent = "+" + formatVND(totalExpectedProfit);

  // Aggregate ingredients
  const ingNeeds = {};
  bakePlans.forEach((bp) => {
    (bp.recipe.items || []).forEach((it) => {
      const ingId = it.ingredient_id;
      const ing = STATE.ingredients.find((x) => x.id === ingId);
      const rUnit = it.recipe_unit || (ing ? ing.unit : "g");
      const sUnit = ing ? ing.unit : rUnit;
      const factor = convertUnitFactor(rUnit, sUnit);

      const neededRec = it.amount * bp.batches;
      const neededStock = neededRec * factor;
      const curStock = ing ? ing.stock : (it.ingredient_stock || 0);
      const costPerUnit = ing ? ing.cost_per_unit : (it.cost_per_unit || 0);

      if (!ingNeeds[ingId]) {
        ingNeeds[ingId] = {
          name: it.ingredient_name || (ing ? ing.name : ""),
          stock_unit: sUnit,
          cur_stock: curStock,
          cost_per_unit: costPerUnit,
          total_stock_needed: 0,
          breakdown: []
        };
      }

      ingNeeds[ingId].total_stock_needed += neededStock;
      ingNeeds[ingId].breakdown.push(`${bp.recipe.name}: -${formatNum(neededRec)} ${rUnit}`);
    });
  });

  const ingList = Object.values(ingNeeds);
  const shortages = [];

  const rowsHtml = ingList
    .map((item) => {
      const remainingStock = item.cur_stock - item.total_stock_needed;
      const isShort = remainingStock < -1e-9;
      if (isShort) {
        shortages.push(
          `${item.name} (cần ${formatNum(item.total_stock_needed)} ${item.stock_unit}, kho chỉ còn ${formatNum(item.cur_stock)} ${item.stock_unit})`
        );
      }

      const breakdownStr = item.breakdown.length > 1 ? `<div class="muted" style="font-size:11px;">Gộp: ${escapeHtml(item.breakdown.join(" | "))}</div>` : "";

      return `
      <tr>
        <td data-label="Nguyên liệu & Tồn kho" class="card-cell-header">
          <strong>${escapeHtml(item.name)}</strong>
          <div class="muted" style="font-size:11.5px;">Kho hiện có: ${formatDualStock(item.cur_stock, item.stock_unit)}</div>
        </td>
        <td data-label="Lượng trừ" class="text-right nowrap-cell">
          <strong class="text-danger">-${formatNum(item.total_stock_needed)} ${escapeHtml(item.stock_unit)}</strong>
          ${breakdownStr}
        </td>
        <td data-label="Sau khi trừ" class="text-right nowrap-cell">
          ${
            isShort
              ? `<span class="stock-pill stock-out">Thiếu ${formatNum(Math.abs(remainingStock))} ${escapeHtml(item.stock_unit)}</span>`
              : `<span class="stock-pill stock-ok">Còn ${formatNum(remainingStock)} ${escapeHtml(item.stock_unit)}</span>`
          }
        </td>
        <td data-label="Giá vốn" class="text-right muted nowrap-cell">${formatVND(item.total_stock_needed * item.cost_per_unit)}</td>
      </tr>
    `;
    })
    .join("");

  if (previewEl) {
    previewEl.innerHTML = `
      <div class="table-responsive">
        <table class="data-table responsive-card-table">
          <thead>
            <tr>
              <th>Nguyên liệu &amp; Tồn kho</th>
              <th class="text-right" style="white-space:nowrap;">Tổng lượng trừ</th>
              <th class="text-right" style="white-space:nowrap;">Sau khi trừ</th>
              <th class="text-right" style="white-space:nowrap;">Giá vốn</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  // Shortage warning
  if (warningEl) {
    if (shortages.length > 0) {
      warningEl.classList.remove("hidden");
      if (shortageListEl) {
        shortageListEl.innerHTML = shortages.map((s) => `<div>• ${escapeHtml(s)}</div>`).join("");
      }
    } else {
      warningEl.classList.add("hidden");
    }
  }

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = `🧁 Xác nhận Làm ${bakePlans.length} loại bánh (${formatNum(totalAllCakes)} cái) & Trừ Kho`;
  }
}

async function submitBake() {
  const selectedEntries = Object.entries(BAKE_SELECTIONS).filter(([id, b]) => Number(b) > 0);
  if (selectedEntries.length === 0) {
    return showToast("Vui lòng chọn ít nhất 1 loại bánh với số lượng > 0.", true);
  }

  const items = selectedEntries.map(([recipe_id, batches]) => ({
    recipe_id: Number(recipe_id),
    batches: Number(batches)
  }));

  const note = (document.getElementById("bake-note-input")?.value || "").trim();
  const allowNegative = document.getElementById("bake-allow-negative")?.checked || false;

  try {
    const res = await apiPost("/api/bake", {
      items,
      allow_negative: allowNegative,
      note
    });

    BAKE_SELECTIONS = {};
    const noteEl = document.getElementById("bake-note-input");
    if (noteEl) noteEl.value = "";
    const negEl = document.getElementById("bake-allow-negative");
    if (negEl) negEl.checked = false;

    showToast("🎉 Đã làm bánh & trừ kho thành công: " + (res.title || ""));
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ==================== 4. INGREDIENTS TAB ==================== */
function setIngFilter(filter) {
  currentIngFilter = filter;
  document.querySelectorAll(".filter-pills .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  renderIngredients();
}

function renderIngredients() {
  const q = (document.getElementById("ing-search")?.value || "").toLowerCase().trim();
  const catFilter = document.getElementById("ing-category-filter")?.value || "";
  const tbody = document.getElementById("ingredients-tbody");

  const filtered = STATE.ingredients.filter((i) => {
    if (currentIngFilter === "low" && i.stock > i.min_stock) return false;
    if (catFilter && (i.category || "Chung") !== catFilter) return false;
    if (q && !i.name.toLowerCase().includes(q) && !(i.category || "").toLowerCase().includes(q)) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center muted" style="padding:28px;">Không tìm thấy nguyên liệu phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((i) => {
      let statusClass = "stock-ok";
      let statusLabel = "Đủ dùng";
      if (i.stock <= 0) {
        statusClass = "stock-out";
        statusLabel = "Hết hàng";
      } else if (i.stock <= i.min_stock) {
        statusClass = "stock-low";
        statusLabel = "Sắp hết";
      }

      const totalVal = i.stock * i.cost_per_unit;
      const uLower = String(i.unit || "").toLowerCase();
      let subUnitPrice = "";
      if (uLower === "kg") {
        subUnitPrice = `<div class="muted" style="font-size:11.5px; white-space:nowrap;">(= <strong>${formatNum(i.cost_per_unit / 1000)} đ / 1g</strong>)</div>`;
      } else if (uLower === "lít" || uLower === "lit") {
        subUnitPrice = `<div class="muted" style="font-size:11.5px; white-space:nowrap;">(= <strong>${formatNum(i.cost_per_unit / 1000)} đ / 1ml</strong>)</div>`;
      }

      const minStockNote = i.min_stock > 0 ? `<span class="muted" style="font-size:11.5px;">• Báo khi &lt; ${formatNum(i.min_stock)} ${escapeHtml(i.unit)}</span>` : "";
      const stockSubText =
        uLower === "kg"
          ? `<div class="muted" style="font-size:11.5px; margin-top:2px;">(= ${formatNum(i.stock * 1000)} g)</div>`
          : uLower === "lít" || uLower === "lit"
          ? `<div class="muted" style="font-size:11.5px; margin-top:2px;">(= ${formatNum(i.stock * 1000)} ml)</div>`
          : "";

      const imgHtml = i.image_url
        ? `<img src="${escapeHtml(i.image_url)}" class="ing-thumb-img" alt="${escapeHtml(i.name)}" />`
        : `<div class="ing-thumb-placeholder">${getIngredientDefaultIcon(i)}</div>`;

      return `
      <tr>
        <td data-label="Nguyên liệu &amp; Phân loại" class="card-cell-header">
          <div class="ing-cell-wrap">
            <div class="ing-thumb-wrap" onclick="triggerChangeIngredientImage(${i.id})" title="Bấm để tải/đổi ảnh nguyên liệu">
              ${imgHtml}
              <span class="thumb-cam-badge">📷</span>
            </div>
            <div class="ing-cell-content">
              <div class="ing-name-title">${escapeHtml(i.name)}</div>
              <div class="ing-meta-row">
                <span class="recipe-cat" style="margin-top:0;">${escapeHtml(i.category || "Chung")}</span>
                ${minStockNote}
              </div>
            </div>
          </div>
        </td>
        <td data-label="Tồn kho hiện tại" class="text-right nowrap-cell">
          <span class="stock-pill ${statusClass}">
            ${formatNum(i.stock)} ${escapeHtml(i.unit)} (${statusLabel})
          </span>
          ${stockSubText}
        </td>
        <td data-label="Giá vốn &amp; Trị giá tồn" class="text-right nowrap-cell">
          <div><strong>${formatVND(i.cost_per_unit)}</strong> <span class="muted" style="font-size:11.5px;">/${escapeHtml(i.unit)}</span></div>
          <div class="muted" style="font-size:11.5px; margin-top:2px;">Trị giá: <strong class="text-amber">${formatVND(totalVal)}</strong></div>
          ${subUnitPrice}
        </td>
        <td data-label="Thao tác" class="text-right card-cell-actions nowrap-cell">
          <div class="action-btn-group">
            <button type="button" class="btn btn-xs btn-primary" onclick="openRestockModal(${i.id})">+ Nhập</button>
            <button type="button" class="btn btn-xs btn-outline" onclick="openIngredientModal(${i.id})">Sửa</button>
            <button type="button" class="btn btn-xs btn-danger-ghost" onclick="deleteIngredient(${i.id})">Xoá</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

function onIngCategorySelectChange() {
  const val = document.getElementById("ing-category-select").value;
  const customInput = document.getElementById("ing-category-custom");
  if (val === "Nguyên liệu khác") {
    customInput.classList.remove("hidden");
    customInput.focus();
  } else {
    customInput.classList.add("hidden");
  }
}

function openIngredientModal(id = null) {
  const modalTitle = document.getElementById("modal-ing-title");
  const catSelect = document.getElementById("ing-category-select");
  const customInput = document.getElementById("ing-category-custom");

  if (id) {
    const ing = STATE.ingredients.find((x) => x.id === id);
    if (!ing) return;
    modalTitle.textContent = "Chỉnh sửa nguyên liệu";
    document.getElementById("ing-id").value = ing.id;
    document.getElementById("ing-name").value = ing.name;

    const existingOptions = Array.from(catSelect.options).map((o) => o.value);
    if (existingOptions.includes(ing.category)) {
      catSelect.value = ing.category;
      customInput.classList.add("hidden");
    } else {
      catSelect.value = "Nguyên liệu khác";
      customInput.value = ing.category || "";
      customInput.classList.remove("hidden");
    }

    document.getElementById("ing-unit").value = ing.unit || "kg";
    document.getElementById("ing-stock").value = ing.stock;
    document.getElementById("ing-min-stock").value = ing.min_stock;
    document.getElementById("ing-pkg-size").value = ing.package_size || 1;
    document.getElementById("ing-pkg-price").value = ing.package_price || Math.round(ing.cost_per_unit * (ing.package_size || 1));

    const imgUrl = ing.image_url || "";
    const imgInput = document.getElementById("ing-image-url");
    const imgPreview = document.getElementById("ing-modal-img-preview");
    if (imgInput) imgInput.value = imgUrl;
    if (imgPreview) {
      if (imgUrl) {
        imgPreview.innerHTML = `<img src="${escapeHtml(imgUrl)}" class="modal-thumb-img" alt="Ảnh nguyên liệu" />`;
      } else {
        imgPreview.innerHTML = getIngredientDefaultIcon(ing);
      }
    }
  } else {
    modalTitle.textContent = "Thêm nguyên liệu mới vào kho";
    document.getElementById("ing-id").value = "";
    document.getElementById("ing-name").value = "";
    catSelect.value = "Bột các loại";
    customInput.value = "";
    customInput.classList.add("hidden");
    document.getElementById("ing-unit").value = "kg";
    document.getElementById("ing-stock").value = 2;
    document.getElementById("ing-min-stock").value = 0.5;
    document.getElementById("ing-pkg-size").value = 1;
    document.getElementById("ing-pkg-price").value = 35000;

    const imgInput = document.getElementById("ing-image-url");
    const imgPreview = document.getElementById("ing-modal-img-preview");
    if (imgInput) imgInput.value = "";
    if (imgPreview) imgPreview.innerHTML = "🥚";
  }
  updateUnitCalcPreview();
  document.getElementById("modal-ingredient").classList.remove("hidden");
}

function updateUnitCalcPreview() {
  const unit = document.getElementById("ing-unit").value || "kg";
  document.querySelectorAll(".unit-label").forEach((el) => (el.textContent = unit));

  const stock = parseFloat(document.getElementById("ing-stock").value) || 0;
  const gramHint = document.getElementById("ing-stock-gram-hint");
  if (unit === "kg") {
    gramHint.textContent = `Tương đương: ${formatNum(stock * 1000)} g (Gram) để làm bánh`;
  } else if (unit === "lít") {
    gramHint.textContent = `Tương đương: ${formatNum(stock * 1000)} ml (Mililit) để làm bánh`;
  } else {
    gramHint.textContent = `Tồn kho: ${formatNum(stock)} ${unit}`;
  }

  const pkgSize = parseFloat(document.getElementById("ing-pkg-size").value) || 1;
  const pkgPrice = parseFloat(document.getElementById("ing-pkg-price").value) || 0;
  const unitCost = pkgSize > 0 ? pkgPrice / pkgSize : 0;

  let extraGramText = "";
  if (unit === "kg") {
    extraGramText = ` (Tương đương <strong>${formatNum(unitCost / 1000)} đ / 1 gram</strong>)`;
  } else if (unit === "lít") {
    extraGramText = ` (Tương đương <strong>${formatNum(unitCost / 1000)} đ / 1 ml</strong>)`;
  }

  document.getElementById("ing-calc-preview").innerHTML = `👉 Đơn giá vốn: <strong>${formatVND(unitCost)} / ${escapeHtml(unit)}</strong>${extraGramText}`;
}

async function saveIngredient() {
  const id = document.getElementById("ing-id").value ? Number(document.getElementById("ing-id").value) : null;
  const name = document.getElementById("ing-name").value.trim();
  const catSelectVal = document.getElementById("ing-category-select").value;
  const category =
    catSelectVal === "Nguyên liệu khác"
      ? document.getElementById("ing-category-custom").value.trim() || "Nguyên liệu khác"
      : catSelectVal;
  const unit = document.getElementById("ing-unit").value;
  const stock = parseFloat(document.getElementById("ing-stock").value) || 0;
  const min_stock = parseFloat(document.getElementById("ing-min-stock").value) || 0;
  const package_size = parseFloat(document.getElementById("ing-pkg-size").value) || 1;
  const package_price = parseFloat(document.getElementById("ing-pkg-price").value) || 0;
  const image_url = document.getElementById("ing-image-url")?.value || "";

  try {
    await apiPost("/api/ingredients/save", {
      id,
      name,
      category,
      unit,
      stock,
      min_stock,
      package_size,
      package_price,
      image_url
    });
    closeModal("modal-ingredient");
    showToast("✅ Đã lưu thông tin nguyên liệu!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteIngredient(id) {
  const ing = STATE.ingredients.find((x) => x.id === id);
  if (!ing) return;
  if (!confirm(`Bạn có chắc muốn xoá nguyên liệu "${ing.name}" khỏi kho?`)) return;

  try {
    await apiPost("/api/ingredients/delete", { id });
    showToast("🗑️ Đã xoá nguyên liệu.");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* RESTOCK MODAL (WITH KG / GRAM SELECTOR) */
function openRestockModal(id) {
  const ing = STATE.ingredients.find((x) => x.id === id);
  if (!ing) return;
  document.getElementById("restock-id").value = ing.id;
  document.getElementById("restock-title").textContent = `Mua thêm: ${ing.name}`;
  document.getElementById("restock-current-info").innerHTML = `
    Đang tồn kho: <strong>${formatDualStock(ing.stock, ing.unit)}</strong> • Giá vốn hiện tại: <strong>${formatVND(ing.cost_per_unit)}/${escapeHtml(ing.unit)}</strong>
  `;

  // Populate compatible purchase units (e.g. both kg and g)
  const unitSel = document.getElementById("restock-add-unit");
  const compat = getCompatibleUnits(ing.unit);
  unitSel.innerHTML = compat
    .map((u) => `<option value="${escapeHtml(u.value)}" ${u.value === ing.unit ? "selected" : ""}>${escapeHtml(u.label)}</option>`)
    .join("");

  const defaultQty = ing.package_size || 1;
  const defaultPrice = ing.package_price || Math.round(defaultQty * ing.cost_per_unit);
  document.getElementById("restock-add-qty").value = defaultQty;
  document.getElementById("restock-total-price").value = defaultPrice;
  document.getElementById("restock-note").value = "";
  updateRestockPreview();
  document.getElementById("modal-restock").classList.remove("hidden");
}

function setRestockQuick(qty, unit) {
  const id = Number(document.getElementById("restock-id").value);
  const ing = STATE.ingredients.find((x) => x.id === id);
  if (!ing) return;

  const unitSel = document.getElementById("restock-add-unit");
  const hasOption = Array.from(unitSel.options).some((o) => o.value === unit);
  if (hasOption) {
    unitSel.value = unit;
  } else {
    unitSel.value = ing.unit;
  }

  document.getElementById("restock-add-qty").value = qty;
  const factor = convertUnitFactor(unitSel.value, ing.unit);
  const qtyInStockUnit = qty * factor;
  document.getElementById("restock-total-price").value = Math.round(qtyInStockUnit * ing.cost_per_unit);
  updateRestockPreview();
}

function updateRestockPreview() {
  const id = Number(document.getElementById("restock-id").value);
  const ing = STATE.ingredients.find((x) => x.id === id);
  if (!ing) return;
  const qty = parseFloat(document.getElementById("restock-add-qty").value) || 0;
  const addUnit = document.getElementById("restock-add-unit").value || ing.unit;
  const price = parseFloat(document.getElementById("restock-total-price").value) || 0;

  const factor = convertUnitFactor(addUnit, ing.unit);
  const addedInStockUnit = qty * factor;
  const newStock = ing.stock + addedInStockUnit;

  const hint = document.getElementById("restock-price-hint");
  if (qty > 0 && price > 0 && addedInStockUnit > 0) {
    hint.textContent = `Cộng thêm +${formatNum(addedInStockUnit)} ${ing.unit} vào kho • Kho mới: ${formatDualStock(newStock, ing.unit)}`;
  } else {
    hint.textContent = `Kho sau khi cộng: ${formatDualStock(newStock, ing.unit)}`;
  }
}

async function submitRestock() {
  const id = Number(document.getElementById("restock-id").value);
  const add_qty = parseFloat(document.getElementById("restock-add-qty").value) || 0;
  const add_unit = document.getElementById("restock-add-unit").value;
  const total_purchase_price = parseFloat(document.getElementById("restock-total-price").value) || 0;
  const note = document.getElementById("restock-note").value.trim();

  try {
    await apiPost("/api/ingredients/restock", {
      id,
      add_qty,
      add_unit,
      total_purchase_price,
      note
    });
    closeModal("modal-restock");
    showToast("✅ Đã cộng thêm nguyên liệu vào kho!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ==================== 5. RECIPES & COSTING TAB ==================== */
function renderRecipes() {
  const grid = document.getElementById("recipes-grid");
  if (STATE.recipes.length === 0) {
    grid.innerHTML = `<div class="card"><p class="muted">Bạn chưa có công thức bánh nào. Bấm "+ Tạo công thức bánh mới" để bắt đầu nhé!</p></div>`;
    return;
  }

  grid.innerHTML = STATE.recipes
    .map((r) => {
      const canBake = r.max_batches > 0;
      const costPerCake = r.cost_per_cake || 0;
      const sellingPricePerCake = r.selling_price || 0;
      const profitPerCake = sellingPricePerCake - costPerCake;
      const margin = sellingPricePerCake > 0 ? Math.round((profitPerCake / sellingPricePerCake) * 100) : 0;
      const weightText = r.cake_weight_gram > 0 ? ` • ⚖️ ${formatNum(r.cake_weight_gram)}g/${escapeHtml(r.yield_unit)}` : "";

      const itemsHtml = r.items
        .map((it) => {
          const rUnit = it.recipe_unit || it.ingredient_unit;
          const sUnit = it.ingredient_unit;
          const isShort = it.ingredient_stock + 1e-9 < it.stock_needed;
          const convNote =
            rUnit.toLowerCase() !== sUnit.toLowerCase()
              ? `<span class="muted" style="font-size:11.5px;">(= ${formatNum(it.stock_needed)} ${escapeHtml(sUnit)})</span>`
              : "";

          return `
          <div class="recipe-ing-row">
            <span>
              ${escapeHtml(it.ingredient_name)}
              ${isShort ? `<span class="text-danger" style="font-size:11.5px;">(Kho chỉ còn ${formatDualStock(it.ingredient_stock, sUnit)})</span>` : ""}
            </span>
            <span>
              <strong>${formatNum(it.amount)} ${escapeHtml(rUnit)}</strong> ${convNote}
              <span class="muted" style="font-size:12px;">(${formatVND(it.item_cost)})</span>
            </span>
          </div>
        `;
        })
        .join("");

      const imgUrl = getRecipeImageUrl(r);
      const imgHtml = imgUrl
        ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(r.name)}" class="recipe-card-img" />`
        : `<div class="recipe-card-img recipe-card-img-placeholder">🧁</div>`;

      return `
      <div class="recipe-card">
        <div>
          <div class="recipe-top">
            <div class="recipe-title-box">
              <div class="recipe-card-img-wrap" onclick="triggerChangeRecipeImage(${r.id})" title="Bấm để tải/đổi ảnh bánh">
                ${imgHtml}
                <span class="recipe-cam-badge">📷 Đổi ảnh</span>
              </div>
              <div class="recipe-title-text-wrap">
                <div class="recipe-title">${escapeHtml(r.name)}</div>
                <span class="recipe-cat">${escapeHtml(r.category || "Bánh ngọt")} • 1 mẻ = ${formatNum(r.yield_qty)} ${escapeHtml(r.yield_unit)}${weightText}</span>
              </div>
            </div>
            ${
              canBake
                ? `<span class="stock-pill stock-ok">Đủ làm ${r.max_cakes || r.max_batches} ${escapeHtml(r.yield_unit)}</span>`
                : `<span class="stock-pill stock-out">Thiếu NL</span>`
            }
          </div>

          <div class="recipe-ing-list">
            ${itemsHtml}
          </div>
          ${r.notes ? `<p class="muted mb-12" style="font-size:12.5px;">📝 ${escapeHtml(r.notes)}</p>` : ""}
        </div>

        <div>
          <div class="recipe-finances">
            <div>
              <span class="muted">Giá vốn 1 ${escapeHtml(r.yield_unit)}</span>
              <strong class="text-amber">${formatVND(costPerCake)}</strong>
              <span class="muted" style="font-size:11px;">(Cả mẻ: ${formatVND(r.total_cost)})</span>
            </div>
            <div>
              <span class="muted">Giá bán 1 ${escapeHtml(r.yield_unit)}</span>
              <strong>${sellingPricePerCake > 0 ? formatVND(sellingPricePerCake) : "—"}</strong>
            </div>
            <div>
              <span class="muted">Lãi 1 ${escapeHtml(r.yield_unit)}</span>
              <strong class="text-green">${sellingPricePerCake > 0 ? `${formatVND(profitPerCake)} (${margin}%)` : "—"}</strong>
            </div>
          </div>

          <div class="recipe-actions">
            <button class="btn btn-secondary flex-1" onclick="jumpToSell(${r.id})">🧾 Bán bánh</button>
            <button class="btn btn-primary flex-1" onclick="jumpToBake(${r.id})">🧁 Làm bánh</button>
            <button class="btn btn-outline" onclick="openRecipeModal(${r.id})">Sửa</button>
            <button class="btn btn-danger-ghost" onclick="deleteRecipe(${r.id})">Xoá</button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

function openRecipeModal(id = null) {
  if (STATE.ingredients.length === 0) {
    return showToast("Vui lòng thêm ít nhất 1 nguyên liệu vào kho trước khi tạo công thức.", true);
  }

  const container = document.getElementById("recipe-items-container");
  container.innerHTML = "";

  if (id) {
    const r = STATE.recipes.find((x) => x.id === id);
    if (!r) return;
    document.getElementById("modal-recipe-title").textContent = "Chỉnh sửa công thức bánh";
    document.getElementById("recipe-id").value = r.id;
    document.getElementById("recipe-name").value = r.name;
    document.getElementById("recipe-category").value = r.category || "Bánh bông lan";
    document.getElementById("recipe-yield-qty").value = r.yield_qty || 1;
    document.getElementById("recipe-yield-unit").value = r.yield_unit || "bánh";
    document.getElementById("recipe-cake-weight").value = r.cake_weight_gram || 0;
    document.getElementById("recipe-selling-price").value = r.selling_price || 0;
    document.getElementById("recipe-notes").value = r.notes || "";

    const imgUrl = r.image_url || "";
    const imgInput = document.getElementById("recipe-image-url");
    const imgPreview = document.getElementById("recipe-modal-img-preview");
    if (imgInput) imgInput.value = imgUrl;
    if (imgPreview) {
      if (imgUrl) {
        imgPreview.innerHTML = `<img src="${escapeHtml(imgUrl)}" class="modal-thumb-img" alt="Ảnh bánh" />`;
      } else {
        imgPreview.innerHTML = "🧁";
      }
    }

    r.items.forEach((it) => addRecipeItemRow(it.ingredient_id, it.amount, it.recipe_unit));
  } else {
    document.getElementById("modal-recipe-title").textContent = "Tạo công thức bánh mới";
    document.getElementById("recipe-id").value = "";
    document.getElementById("recipe-name").value = "";
    document.getElementById("recipe-category").value = "Bánh bông lan";
    document.getElementById("recipe-yield-qty").value = 1;
    document.getElementById("recipe-yield-unit").value = "bánh";
    document.getElementById("recipe-cake-weight").value = 250;
    document.getElementById("recipe-selling-price").value = 65000;
    document.getElementById("recipe-notes").value = "";

    const imgInput = document.getElementById("recipe-image-url");
    const imgPreview = document.getElementById("recipe-modal-img-preview");
    if (imgInput) imgInput.value = "";
    if (imgPreview) imgPreview.innerHTML = "🧁";

    const firstIng = STATE.ingredients[0];
    if (firstIng) addRecipeItemRow(firstIng.id, 100, defaultRecipeUnitFor(firstIng.unit));
    const secondIng = STATE.ingredients[1];
    if (secondIng) addRecipeItemRow(secondIng.id, 50, defaultRecipeUnitFor(secondIng.unit));
  }

  updateRecipeModalCost();
  document.getElementById("modal-recipe").classList.remove("hidden");
}

function addRecipeItemRow(selectedIngId = null, amount = "", selectedRecipeUnit = null) {
  const container = document.getElementById("recipe-items-container");
  const row = document.createElement("div");
  row.className = "recipe-item-row";

  const targetIng = STATE.ingredients.find((x) => String(x.id) === String(selectedIngId)) || STATE.ingredients[0];
  const rUnit = selectedRecipeUnit || defaultRecipeUnitFor(targetIng?.unit);

  const optionsHtml = STATE.ingredients
    .map(
      (ing) =>
        `<option value="${ing.id}" ${String(ing.id) === String(targetIng?.id) ? "selected" : ""}>
          ${escapeHtml(ing.name)} (Kho: ${formatDualStock(ing.stock, ing.unit)})
        </option>`
    )
    .join("");

  const compatUnits = getCompatibleUnits(targetIng?.unit);
  const unitOptionsHtml = compatUnits
    .map((u) => `<option value="${escapeHtml(u.value)}" ${u.value === rUnit ? "selected" : ""}>${escapeHtml(u.label)}</option>`)
    .join("");

  row.innerHTML = `
    <select class="form-control rec-ing-select" onchange="onRecipeIngSelectChange(this)">
      ${optionsHtml}
    </select>
    <input type="number" class="form-control rec-ing-amount" placeholder="Số lượng" value="${amount}" min="0.1" step="any" oninput="updateRecipeModalCost()" />
    <select class="form-control rec-ing-unit" onchange="updateRecipeModalCost()">
      ${unitOptionsHtml}
    </select>
    <div class="rec-conv-note">0 đ</div>
    <button type="button" class="btn btn-sm btn-danger-ghost" onclick="this.parentElement.remove(); updateRecipeModalCost();">✕</button>
  `;
  container.appendChild(row);
  updateRecipeModalCost();
}

function onRecipeIngSelectChange(selectEl) {
  const row = selectEl.closest(".recipe-item-row");
  const ing = STATE.ingredients.find((x) => String(x.id) === String(selectEl.value));
  if (!ing) return;

  const unitSel = row.querySelector(".rec-ing-unit");
  const defaultUnit = defaultRecipeUnitFor(ing.unit);
  const compatUnits = getCompatibleUnits(ing.unit);
  unitSel.innerHTML = compatUnits
    .map((u) => `<option value="${escapeHtml(u.value)}" ${u.value === defaultUnit ? "selected" : ""}>${escapeHtml(u.label)}</option>`)
    .join("");

  updateRecipeModalCost();
}

function updateRecipeModalCost() {
  let totalBatchCost = 0;
  let totalGramWeight = 0;

  document.querySelectorAll("#recipe-items-container .recipe-item-row").forEach((row) => {
    const sel = row.querySelector(".rec-ing-select");
    const amt = parseFloat(row.querySelector(".rec-ing-amount").value) || 0;
    const rUnit = row.querySelector(".rec-ing-unit")?.value || "g";
    const convNoteEl = row.querySelector(".rec-conv-note");

    const ing = STATE.ingredients.find((x) => String(x.id) === String(sel.value));
    if (ing && amt > 0) {
      const factor = convertUnitFactor(rUnit, ing.unit);
      const stockNeeded = amt * factor;
      const itemCost = stockNeeded * ing.cost_per_unit;
      totalBatchCost += itemCost;

      if (rUnit.toLowerCase() in METRIC_FACTORS) {
        totalGramWeight += amt * METRIC_FACTORS[rUnit.toLowerCase()];
      }

      if (rUnit.toLowerCase() !== ing.unit.toLowerCase()) {
        convNoteEl.innerHTML = `Trừ <strong>${formatNum(stockNeeded)} ${escapeHtml(ing.unit)}</strong> • <strong>${formatVND(itemCost)}</strong>`;
      } else {
        convNoteEl.innerHTML = `Giá vốn: <strong>${formatVND(itemCost)}</strong>`;
      }
    } else if (convNoteEl) {
      convNoteEl.textContent = "0 đ";
    }
  });

  const yieldQty = parseFloat(document.getElementById("recipe-yield-qty").value) || 1;
  const yieldUnit = document.getElementById("recipe-yield-unit").value || "bánh";
  const sellingPricePerCake = parseFloat(document.getElementById("recipe-selling-price").value) || 0;
  const costPerCake = yieldQty > 0 ? totalBatchCost / yieldQty : totalBatchCost;
  const profitPerCake = sellingPricePerCake - costPerCake;

  document.getElementById("recipe-modal-cost-bar").innerHTML = `
    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; align-items:center;">
      <span class="muted">Tổng khối lượng nguyên liệu: <strong>~${formatNum(totalGramWeight)} g</strong> (Giá vốn cả mẻ: <strong>${formatVND(totalBatchCost)}</strong>)</span>
      <span>
        Giá vốn 1 ${escapeHtml(yieldUnit)}: <strong class="text-amber">${formatVND(costPerCake)}</strong> •
        Giá bán 1 ${escapeHtml(yieldUnit)}: <strong>${formatVND(sellingPricePerCake)}</strong> •
        Lãi 1 ${escapeHtml(yieldUnit)}: <strong class="text-green">${formatVND(profitPerCake)}</strong>
      </span>
    </div>
  `;
}

async function saveRecipe() {
  const id = document.getElementById("recipe-id").value ? Number(document.getElementById("recipe-id").value) : null;
  const name = document.getElementById("recipe-name").value.trim();
  const category = document.getElementById("recipe-category").value.trim();
  const yield_qty = parseFloat(document.getElementById("recipe-yield-qty").value) || 1;
  const yield_unit = document.getElementById("recipe-yield-unit").value.trim() || "bánh";
  const cake_weight_gram = parseFloat(document.getElementById("recipe-cake-weight").value) || 0;
  const selling_price = parseFloat(document.getElementById("recipe-selling-price").value) || 0;
  const notes = document.getElementById("recipe-notes").value.trim();
  const image_url = document.getElementById("recipe-image-url")?.value || "";

  const items = [];
  document.querySelectorAll("#recipe-items-container .recipe-item-row").forEach((row) => {
    const ingredient_id = Number(row.querySelector(".rec-ing-select").value);
    const amount = parseFloat(row.querySelector(".rec-ing-amount").value) || 0;
    const recipe_unit = row.querySelector(".rec-ing-unit")?.value || "g";
    if (ingredient_id > 0 && amount > 0) {
      items.push({ ingredient_id, amount, recipe_unit });
    }
  });

  try {
    await apiPost("/api/recipes/save", {
      id,
      name,
      category,
      yield_qty,
      yield_unit,
      cake_weight_gram,
      selling_price,
      image_url,
      notes,
      items
    });
    closeModal("modal-recipe");
    showToast("✅ Đã lưu công thức bánh!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteRecipe(id) {
  const r = STATE.recipes.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`Bạn có chắc muốn xoá công thức "${r.name}"?`)) return;

  try {
    await apiPost("/api/recipes/delete", { id });
    showToast("🗑️ Đã xoá công thức bánh.");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ==================== 6. HISTORY & PERSONAL ACTIVITY LOG TAB ==================== */
function setHistoryViewMode(mode) {
  currentHistoryViewMode = mode || "all";
  document.querySelectorAll("#tab-history .filter-pills .pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.hview === currentHistoryViewMode);
  });
  const whSec = document.getElementById("warehouse-history-section");
  const actSec = document.getElementById("personal-activity-section");
  const custSec = document.getElementById("customer-database-section");
  if (whSec) {
    whSec.classList.toggle("hidden", currentHistoryViewMode !== "all" && currentHistoryViewMode !== "warehouse");
  }
  if (actSec) {
    actSec.classList.toggle("hidden", currentHistoryViewMode !== "all" && currentHistoryViewMode !== "activity");
  }
  if (custSec) {
    custSec.classList.toggle("hidden", currentHistoryViewMode !== "all" && currentHistoryViewMode !== "customer");
  }
}

function renderTxItemHTML(tx, allowActions = true) {
  const typeLabels = {
    BAKE: "🧁 Làm bánh (Trừ kho)",
    RESTOCK: "📥 Mua vào (Nhập kho)",
    ADJUST: "⚖️ Kiểm kê / Điều chỉnh"
  };
  const label = typeLabels[tx.type] || tx.type;
  const pills = (tx.details || [])
    .map(
      (d) =>
        `<span class="tx-pill"><strong>${escapeHtml(d.name)}</strong>: ${escapeHtml(d.change)} ${escapeHtml(d.unit || "")}</span>`
    )
    .join("");

  const isSelected = allowActions && selectedTxIds.has(Number(tx.id));

  return `
    <div class="tx-item ${isSelected ? "selected" : ""}" id="tx-row-${tx.id}">
      <div class="tx-item-left">
        ${
          allowActions
            ? `<div class="tx-check-wrap">
                 <input type="checkbox" class="tx-check-input tx-row-cb" data-id="${tx.id}" ${isSelected ? "checked" : ""} onchange="toggleSelectTransaction(${tx.id}, this.checked)" title="Chọn mục này để xoá" />
               </div>`
            : ""
        }
        <div>
          <div>
            <span class="tx-badge ${tx.type}">${label}</span>
            <span class="tx-title">${escapeHtml(tx.title)}</span>
          </div>
          <div class="tx-time">🕒 ${escapeHtml(tx.created_at)} ${tx.total_cost > 0 ? `• Giá vốn: <strong>${formatVND(tx.total_cost)}</strong>` : ""}</div>
          <div class="tx-pills">${pills}</div>
        </div>
      </div>
      ${
        allowActions
          ? `<div class="tx-actions">
               <button class="btn btn-sm btn-outline" onclick="undoTransaction(${tx.id})" title="Khôi phục lại số lượng nguyên liệu vào kho và xoá giao dịch này">↩️ Hoàn tác kho</button>
               <button class="btn btn-sm btn-danger-ghost" onclick="deleteSingleTransaction(${tx.id})" title="Chỉ xoá dòng lịch sử này (Không thay đổi số lượng tồn kho)">🗑️ Xoá</button>
             </div>`
          : ""
      }
    </div>
  `;
}

function renderHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;

  const txs = STATE.transactions || [];
  const validIds = new Set(txs.map((t) => Number(t.id)));
  selectedTxIds.forEach((id) => {
    if (!validIds.has(id)) selectedTxIds.delete(id);
  });

  const totalCountEl = document.getElementById("tx-total-count");
  if (totalCountEl) totalCountEl.textContent = txs.length;

  if (txs.length === 0) {
    container.innerHTML = `<p class="muted" style="padding: 12px 0;">Chưa có lịch sử biến động kho nào.</p>`;
  } else {
    container.innerHTML = txs.map((tx) => renderTxItemHTML(tx, true)).join("");
  }

  updateTxSelectionUI();
}

function toggleSelectTransaction(id, checked) {
  const numId = Number(id);
  if (checked) {
    selectedTxIds.add(numId);
  } else {
    selectedTxIds.delete(numId);
  }
  const row = document.getElementById(`tx-row-${numId}`);
  if (row) row.classList.toggle("selected", checked);
  updateTxSelectionUI();
}

function toggleSelectAllTransactions(checked) {
  const txs = STATE.transactions || [];
  if (checked) {
    txs.forEach((tx) => selectedTxIds.add(Number(tx.id)));
  } else {
    selectedTxIds.clear();
  }
  document.querySelectorAll("#history-list .tx-row-cb").forEach((cb) => {
    cb.checked = checked;
    const row = cb.closest(".tx-item");
    if (row) row.classList.toggle("selected", checked);
  });
  updateTxSelectionUI();
}

function updateTxSelectionUI() {
  const txs = STATE.transactions || [];
  const count = selectedTxIds.size;
  const countEl = document.getElementById("tx-selected-count");
  if (countEl) countEl.textContent = count;

  const delBtn = document.getElementById("btn-delete-selected-tx");
  if (delBtn) delBtn.disabled = count === 0;

  const selectAllCb = document.getElementById("tx-select-all-cb");
  if (selectAllCb) {
    selectAllCb.checked = txs.length > 0 && count === txs.length;
    selectAllCb.indeterminate = count > 0 && count < txs.length;
  }
}

async function deleteSingleTransaction(id) {
  if (!confirm("Bạn muốn xoá dòng lịch sử kho này?\n(Lưu ý: Số lượng nguyên liệu tồn kho hiện tại sẽ được giữ nguyên, không bị thay đổi)")) {
    return;
  }
  try {
    await apiPost("/api/transactions/delete", { ids: [Number(id)] });
    selectedTxIds.delete(Number(id));
    showToast("🗑️ Đã xoá mục lịch sử kho!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteSelectedTransactions() {
  const ids = Array.from(selectedTxIds);
  if (ids.length === 0) {
    return showToast("Vui lòng tích chọn ít nhất 1 lịch sử kho để xoá.", true);
  }
  if (!confirm(`Bạn có chắc muốn xoá ${ids.length} mục lịch sử kho đã chọn?\n(Số lượng nguyên liệu tồn kho hiện tại vẫn giữ nguyên)`)) {
    return;
  }
  try {
    await apiPost("/api/transactions/delete", { ids });
    selectedTxIds.clear();
    showToast(`🗑️ Đã xoá ${ids.length} mục lịch sử kho đã chọn!`);
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteAllTransactions() {
  const total = (STATE.transactions || []).length;
  if (total === 0) {
    return showToast("Lịch sử kho hiện đang trống.", true);
  }
  if (!confirm(`Bạn có chắc chắn muốn XOÁ TOÀN BỘ (${total} mục) lịch sử biến động kho không?\n(Số lượng nguyên liệu tồn kho hiện tại sẽ giữ nguyên)`)) {
    return;
  }
  try {
    await apiPost("/api/transactions/delete", { all: true });
    selectedTxIds.clear();
    showToast("🧹 Đã xoá toàn bộ lịch sử kho!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function undoTransaction(id) {
  if (!confirm("Bạn có muốn hoàn tác giao dịch này? Số lượng nguyên liệu trong kho sẽ được cộng/trừ khôi phục lại như trước.")) {
    return;
  }
  try {
    await apiPost("/api/transactions/undo", { id });
    selectedTxIds.delete(Number(id));
    showToast("↩️ Đã hoàn tác và khôi phục số lượng tồn kho!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ==================== PERSONAL ACTIVITY LOGS ==================== */
function getFilteredActivityLogs() {
  const allLogs = STATE.activity_logs || [];
  const filterType = document.getElementById("act-type-filter")?.value || "";
  if (!filterType) return allLogs;
  if (filterType === "HISTORY") {
    return allLogs.filter((x) => x.action_type === "HISTORY" || x.action_type === "UNDO");
  }
  if (filterType === "SETTINGS") {
    return allLogs.filter((x) => x.action_type === "SETTINGS" || x.action_type === "SYSTEM" || x.action_type === "ACTION");
  }
  return allLogs.filter((x) => x.action_type === filterType);
}

function renderActivityLogs() {
  const container = document.getElementById("activity-log-list");
  if (!container) return;

  const allLogs = STATE.activity_logs || [];
  const validIds = new Set(allLogs.map((a) => Number(a.id)));
  selectedActIds.forEach((id) => {
    if (!validIds.has(id)) selectedActIds.delete(id);
  });

  const logs = getFilteredActivityLogs();
  const totalCountEl = document.getElementById("act-total-count");
  if (totalCountEl) totalCountEl.textContent = logs.length;

  const actionLabels = {
    ORDER: "🧾 Bán bánh & In Bill",
    BAKE: "🧁 Làm bánh (Trừ kho)",
    RESTOCK: "📥 Nhập kho nguyên liệu",
    INGREDIENT: "🥚 Kho nguyên liệu",
    RECIPE: "📖 Công thức bánh",
    HISTORY: "🗑️ Xoá lịch sử",
    UNDO: "↩️ Hoàn tác kho",
    SETTINGS: "⚙️ Cài đặt & Tiện ích",
    SYSTEM: "✨ Hệ thống"
  };

  if (logs.length === 0) {
    container.innerHTML = `<p class="muted" style="padding: 12px 0;">Chưa có lịch sử thao tác cá nhân nào trong mục này.</p>`;
  } else {
    container.innerHTML = logs
      .map((act) => {
        const isSelected = selectedActIds.has(Number(act.id));
        const badgeLabel = actionLabels[act.action_type] || "👤 Thao tác cá nhân";
        return `
        <div class="tx-item ${isSelected ? "selected" : ""}" id="act-row-${act.id}">
          <div class="tx-item-left">
            <div class="tx-check-wrap">
              <input type="checkbox" class="tx-check-input act-row-cb" data-id="${act.id}" ${isSelected ? "checked" : ""} onchange="toggleSelectActivity(${act.id}, this.checked)" title="Chọn thao tác này để xoá" />
            </div>
            <div>
              <div>
                <span class="tx-badge ${escapeHtml(act.action_type || "SYSTEM")}">${badgeLabel}</span>
                <span class="tx-title">${escapeHtml(act.description)}</span>
              </div>
              <div class="tx-time">🕒 Thực hiện lúc: ${escapeHtml(act.created_at)}</div>
            </div>
          </div>
          <div class="tx-actions">
            <button class="btn btn-sm btn-danger-ghost" onclick="deleteSingleActivity(${act.id})" title="Xoá dòng nhật ký thao tác này">🗑️ Xoá</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  updateActSelectionUI();
}

function toggleSelectActivity(id, checked) {
  const numId = Number(id);
  if (checked) {
    selectedActIds.add(numId);
  } else {
    selectedActIds.delete(numId);
  }
  const row = document.getElementById(`act-row-${numId}`);
  if (row) row.classList.toggle("selected", checked);
  updateActSelectionUI();
}

function toggleSelectAllActivities(checked) {
  const visibleLogs = getFilteredActivityLogs();
  if (checked) {
    visibleLogs.forEach((act) => selectedActIds.add(Number(act.id)));
  } else {
    visibleLogs.forEach((act) => selectedActIds.delete(Number(act.id)));
  }
  document.querySelectorAll("#activity-log-list .act-row-cb").forEach((cb) => {
    cb.checked = checked;
    const row = cb.closest(".tx-item");
    if (row) row.classList.toggle("selected", checked);
  });
  updateActSelectionUI();
}

function updateActSelectionUI() {
  const visibleLogs = getFilteredActivityLogs();
  const count = selectedActIds.size;
  const countEl = document.getElementById("act-selected-count");
  if (countEl) countEl.textContent = count;

  const delBtn = document.getElementById("btn-delete-selected-act");
  if (delBtn) delBtn.disabled = count === 0;

  const selectAllCb = document.getElementById("act-select-all-cb");
  if (selectAllCb) {
    const visibleSelectedCount = visibleLogs.filter((x) => selectedActIds.has(Number(x.id))).length;
    selectAllCb.checked = visibleLogs.length > 0 && visibleSelectedCount === visibleLogs.length;
    selectAllCb.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleLogs.length;
  }
}

async function deleteSingleActivity(id) {
  try {
    await apiPost("/api/activity/delete", { ids: [Number(id)] });
    selectedActIds.delete(Number(id));
    showToast("🗑️ Đã xoá dòng nhật ký thao tác!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteSelectedActivities() {
  const ids = Array.from(selectedActIds);
  if (ids.length === 0) {
    return showToast("Vui lòng tích chọn ít nhất 1 thao tác để xoá.", true);
  }
  if (!confirm(`Bạn muốn xoá ${ids.length} mục lịch sử thao tác cá nhân đã chọn?`)) {
    return;
  }
  try {
    await apiPost("/api/activity/delete", { ids });
    selectedActIds.clear();
    showToast(`🗑️ Đã xoá ${ids.length} nhật ký thao tác đã chọn!`);
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteAllActivities() {
  const total = (STATE.activity_logs || []).length;
  if (total === 0) {
    return showToast("Nhật ký thao tác cá nhân hiện đang trống.", true);
  }
  if (!confirm(`Bạn có chắc muốn XOÁ TOÀN BỘ (${total} mục) lịch sử thao tác cá nhân không?`)) {
    return;
  }
  try {
    await apiPost("/api/activity/delete", { all: true });
    selectedActIds.clear();
    showToast("🧹 Đã xoá toàn bộ nhật ký thao tác cá nhân!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ==================== UTILITIES & EXPORTS ==================== */
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function updateCloudStatusBadges() {
  const cloudUrl = getCloudDbUrl();
  const isConnected = Boolean(cloudUrl);

  const sidebarTitle = document.getElementById("sidebar-sync-title");
  if (sidebarTitle) {
    sidebarTitle.textContent = isConnected ? "🟢 Cloud DB: Tự động lưu" : "☁️ Đồng bộ Máy tính & ĐT";
  }
  const sidebarHint = document.getElementById("sidebar-sync-hint");
  if (sidebarHint) {
    sidebarHint.textContent = isConnected ? "Đang tự động lưu vĩnh viễn" : "Bấm cài đặt Cloud / Quét QR";
  }

  const mobileBtn = document.getElementById("mobile-cloud-btn");
  if (mobileBtn) {
    mobileBtn.textContent = isConnected ? "🟢 Tự động lưu" : "☁️ Đồng bộ";
    mobileBtn.classList.toggle("btn-primary", isConnected);
    mobileBtn.classList.toggle("btn-outline", !isConnected);
  }

  const dashBtn = document.getElementById("dashboard-cloud-btn");
  if (dashBtn) {
    dashBtn.textContent = isConnected ? "🟢 Cloud DB: Tự động lưu" : "☁️ Đồng bộ Máy tính & ĐT";
    dashBtn.classList.toggle("btn-secondary", isConnected);
  }

  const modalBadge = document.getElementById("cloud-sync-status-badge");
  if (modalBadge) {
    if (isConnected) {
      modalBadge.className = "stock-pill stock-ok";
      modalBadge.textContent = "🟢 Tự động lưu 100%";
    } else {
      modalBadge.className = "stock-pill stock-low";
      modalBadge.textContent = "Chưa kết nối Cloud";
    }
  }

  const inputEl = document.getElementById("cloud-db-url-input");
  if (inputEl && document.activeElement !== inputEl) {
    inputEl.value = cloudUrl;
  }
}

async function forceSyncCloudNow() {
  try {
    showToast("⏳ Đang đồng bộ dữ liệu mới nhất từ Cloud Database...");
    const cloudUrl = getCloudDbUrl();
    if (cloudUrl) {
      await fetchStateFromCloud(cloudUrl);
    }
    await loadState();
    showToast("🟢 Đã đồng bộ thành công! Dữ liệu đang tự động lưu.");
  } catch (err) {
    showToast("Lỗi đồng bộ: " + err.message, true);
  }
}

function openMobileModal() {
  updateCloudStatusBadges();
  const cloudUrl = getCloudDbUrl();
  let baseOrigin = STATE.server_info?.url || window.location.origin;
  if (window.location.origin && !window.location.origin.includes("localhost") && !window.location.origin.includes("127.0.0.1")) {
    baseOrigin = window.location.origin;
  }
  let finalMobileUrl = baseOrigin;
  if (cloudUrl) {
    finalMobileUrl += (finalMobileUrl.includes("?") ? "&" : "?") + `cloud=${encodeURIComponent(cloudUrl)}`;
  }

  document.getElementById("mobile-url-text").textContent = finalMobileUrl;
  const qrImg = document.getElementById("mobile-qr-img");
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(finalMobileUrl)}`;
  document.getElementById("modal-mobile").classList.remove("hidden");
}

function copyMobileUrl() {
  const url = document.getElementById("mobile-url-text").textContent;
  navigator.clipboard?.writeText(url);
  showToast("📋 Đã sao chép link (đã kèm mã Cloud đồng bộ)!");
}

async function saveAndConnectCloudDb(pushLocalFirst = true) {
  const raw = document.getElementById("cloud-db-url-input")?.value || "";
  const clean = normalizeCloudUrl(raw);
  if (!clean) {
    return showToast("Vui lòng dán đường dẫn Firebase Realtime Database URL!", true);
  }

  try {
    showToast("⏳ Đang kết nối tới Cloud Database...");
    localStorage.setItem(CLOUD_URL_STORAGE_KEY, clean);

    if (pushLocalFirst) {
      const curLocal = await getLocalVercelState();
      await pushStateToCloud(curLocal, clean);
      showToast("🎉 Đã đẩy toàn bộ dữ liệu máy này lên Cloud thành công!");
    } else {
      const remoteData = await fetchStateFromCloud(clean);
      if (remoteData) {
        showToast("🎉 Đã tải dữ liệu từ Cloud về máy này thành công!");
      }
    }
    updateCloudStatusBadges();
    await loadState();
  } catch (err) {
    showToast("Lỗi kết nối Cloud: " + err.message, true);
  }
}

async function disconnectCloudDb() {
  if (!confirm("Bạn có chắc muốn ngắt kết nối Cloud trên máy này?")) return;
  localStorage.removeItem(CLOUD_URL_STORAGE_KEY);
  updateCloudStatusBadges();
  showToast("Đã ngắt kết nối Cloud. Máy sẽ lưu dữ liệu bộ nhớ cục bộ.");
  await loadState();
}

function exportFullBackupJSON() {
  const backup = {
    app: "MỀM BARKERY",
    version: "1.0",
    exported_at: nowStr(),
    state: STATE
  };
  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mem-barkery-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  showToast("📥 Đã tải file Backup dữ liệu!");
}

async function importFullBackupJSON(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const data = parsed.state || parsed;
    if (!data.ingredients || !Array.isArray(data.ingredients)) {
      return showToast("File sao lưu không hợp lệ!", true);
    }
    if (!confirm(`Xác nhận nhập file backup: ${data.ingredients.length} nguyên liệu, ${(data.recipes || []).length} công thức? Dữ liệu hiện tại sẽ được thay thế.`)) {
      event.target.value = "";
      return;
    }
    const computed = recomputeRecipesInState(data);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(computed));
    const cloudUrl = getCloudDbUrl();
    if (cloudUrl) {
      await pushStateToCloud(computed, cloudUrl);
    }
    showToast("🎉 Đã nhập dữ liệu từ file backup thành công!");
    closeModal("modal-mobile");
    await loadState();
  } catch (err) {
    showToast("Lỗi đọc file: " + err.message, true);
  } finally {
    event.target.value = "";
  }
}

// Background auto-sync (Every 6 seconds check if another device changed data on Cloud)
setInterval(async () => {
  const cloudUrl = getCloudDbUrl();
  if (!cloudUrl) return;
  // Don't refresh if user is currently typing in an input or a modal is open
  const activeTag = document.activeElement?.tagName;
  if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
  const anyModalOpen = document.querySelector(".modal-backdrop:not(.hidden)");
  if (anyModalOpen) return;

  try {
    const res = await fetch(`${cloudUrl}/bakery_state/sync_updated_at.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const remoteTime = await res.json();
      const localTime = Number(STATE.sync_updated_at) || 0;
      if (remoteTime && Number(remoteTime) > localTime) {
        await loadState();
      }
    }
  } catch (e) {}
}, 6000);

window.addEventListener("focus", () => {
  if (getCloudDbUrl()) {
    loadState();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && getCloudDbUrl()) {
    loadState();
  }
});

function exportIngredientsCSV() {
  const headers = ["Tên nguyên liệu", "Phân loại", "Đơn vị", "Tồn kho hiện tại", "Mức báo sắp hết", "Đơn giá vốn (VNĐ)", "Tổng giá trị tồn (VNĐ)"];
  const rows = STATE.ingredients.map((i) => [
    `"${(i.name || "").replace(/"/g, '""')}"`,
    `"${(i.category || "").replace(/"/g, '""')}"`,
    `"${i.unit}"`,
    i.stock,
    i.min_stock,
    Math.round(i.cost_per_unit),
    Math.round(i.stock * i.cost_per_unit)
  ]);

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `kho-nguyen-lieu-banh-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  logClientActivity("SETTINGS", `Xuất file Excel (CSV) danh sách kho nguyên liệu (${STATE.ingredients.length} loại)`);
}

function exportOrdersCSV() {
  const targetOrders = typeof getFilteredOrders === "function" ? getFilteredOrders() : STATE.orders || [];
  if (targetOrders.length === 0) {
    return showToast("Không có hóa đơn nào để xuất file.", true);
  }

  const headers = ["Mã Bill", "Ngày giờ", "Khách hàng", "Số điện thoại", "Thanh toán", "Chi tiết bánh", "Tổng thu (VNĐ)", "Giá vốn (VNĐ)", "Lợi nhuận (VNĐ)"];
  const rows = targetOrders.map((o) => {
    const itemsStr = (o.items || []).map((it) => `${it.qty}x ${it.name}`).join("; ");
    const profit = (o.total_amount || 0) - (o.total_cost || 0);
    return [
      `"${o.bill_code}"`,
      `"${o.created_at}"`,
      `"${(o.customer_name || "").replace(/"/g, '""')}"`,
      `"${(o.customer_phone || "").replace(/"/g, '""')}"`,
      `"${o.payment_method || ""}"`,
      `"${itemsStr.replace(/"/g, '""')}"`,
      Math.round(o.total_amount || 0),
      Math.round(o.total_cost || 0),
      Math.round(profit)
    ];
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `doanh-thu-ban-banh-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  logClientActivity("SETTINGS", `Xuất file Excel (CSV) báo cáo doanh thu bán bánh (${targetOrders.length} đơn)`);
}

/* ==================== 7. CUSTOMER DATABASE & SUPPORT SUMMARY ==================== */
function getCustomerDatabaseList() {
  const orders = STATE.orders || [];
  const map = new Map();

  orders.forEach((o) => {
    const rawName = (o.customer_name || "").trim() || "Khách lẻ";
    const phone = (o.customer_phone || "").trim();
    const key = (phone ? `${phone}__` : "") + rawName.toLowerCase();

    if (!map.has(key)) {
      map.set(key, {
        name: rawName,
        phone: phone,
        order_count: 0,
        total_spent: 0,
        total_cakes: 0,
        cakes_map: {},
        last_order_at: o.created_at || ""
      });
    }

    const c = map.get(key);
    c.order_count += 1;
    c.total_spent += Number(o.total_amount) || 0;
    if (phone && !c.phone) c.phone = phone;
    if (!c.last_order_at || String(o.created_at) > String(c.last_order_at)) {
      c.last_order_at = o.created_at;
    }

    (o.items || []).forEach((it) => {
      const q = Number(it.qty) || 0;
      c.total_cakes += q;
      const cakeName = (it.name || "Món khác").trim();
      c.cakes_map[cakeName] = (c.cakes_map[cakeName] || 0) + q;
    });
  });

  return Array.from(map.values()).sort((a, b) => b.total_spent - a.total_spent);
}

function renderCustomerDatabase() {
  const container = document.getElementById("customer-database-list");
  if (!container) return;

  const q = (document.getElementById("customer-db-search")?.value || "").toLowerCase().trim();
  const allCustomers = getCustomerDatabaseList();

  // Update total customer count
  const countEl = document.getElementById("customer-total-count");
  if (countEl) countEl.textContent = allCustomers.length;

  // KPI cards
  const kpiCustEl = document.getElementById("cust-kpi-total-cust");
  const kpiCakesEl = document.getElementById("cust-kpi-total-cakes");
  const kpiSpentEl = document.getElementById("cust-kpi-total-spent");
  const kpiTopEl = document.getElementById("cust-kpi-top-cust");

  let grandCakes = 0;
  let grandSpent = 0;
  allCustomers.forEach((c) => {
    grandCakes += c.total_cakes;
    grandSpent += c.total_spent;
  });

  if (kpiCustEl) kpiCustEl.textContent = `${allCustomers.length} khách`;
  if (kpiCakesEl) kpiCakesEl.textContent = `${formatNum(grandCakes)} cái`;
  if (kpiSpentEl) kpiSpentEl.textContent = formatVND(grandSpent);
  if (kpiTopEl) {
    if (allCustomers.length > 0 && allCustomers[0].name) {
      kpiTopEl.textContent = `${allCustomers[0].name} (${formatVND(allCustomers[0].total_spent)})`;
    } else {
      kpiTopEl.textContent = "—";
    }
  }

  const filtered = allCustomers.filter((c) => {
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card text-center muted" style="padding: 28px; grid-column: 1 / -1;">${allCustomers.length === 0 ? "Chưa có dữ liệu khách hàng nào (dữ liệu sẽ tự động tạo khi bạn xuất hóa đơn bán bánh)." : "Không tìm thấy khách hàng phù hợp."}</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((c) => {
      const cakePills = Object.entries(c.cakes_map)
        .sort((a, b) => b[1] - a[1])
        .map(([name, qty]) => `<span class="cust-cake-pill">🍰 ${escapeHtml(name)}: <strong>${formatNum(qty)}</strong></span>`)
        .join("");

      const safeName = escapeHtml(c.name).replace(/'/g, "\\'");
      const safePhone = escapeHtml(c.phone).replace(/'/g, "\\'");

      return `
      <div class="customer-card">
        <div class="cust-card-header">
          <div class="cust-card-identity">
            <div class="cust-card-avatar">👤</div>
            <div>
              <div class="cust-card-name">${escapeHtml(c.name)}</div>
              ${c.phone ? `<div class="cust-card-phone">📞 <a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></div>` : `<span class="muted" style="font-size:12px;">Chưa lưu SĐT</span>`}
            </div>
          </div>
          <button type="button" class="btn btn-xs btn-primary cust-card-act" onclick="quickOrderForCustomer('${safeName}', '${safePhone}')">
            🧾 Bán nhanh
          </button>
        </div>

        <div class="cust-card-stats">
          <div class="cust-stat-item">
            <span class="cust-stat-label">Số đơn</span>
            <span class="cust-stat-val"><strong>${c.order_count}</strong> đơn</span>
          </div>
          <div class="cust-stat-item">
            <span class="cust-stat-label">Đã mua</span>
            <span class="cust-stat-val"><strong class="text-amber">${formatNum(c.total_cakes)}</strong> cái</span>
          </div>
          <div class="cust-stat-item">
            <span class="cust-stat-label">Tổng ủng hộ</span>
            <span class="cust-stat-val"><strong class="text-green">${formatVND(c.total_spent)}</strong></span>
          </div>
        </div>

        <div class="cust-card-cakes">
          <div class="cust-cakes-label">Các loại bánh đã ủng hộ:</div>
          <div class="cust-cakes-wrap">
            ${cakePills || '<span class="muted" style="font-size:12px;">Chưa rõ món cụ thể</span>'}
          </div>
        </div>

        <div class="cust-card-footer">
          <span class="muted" style="font-size:11.5px;">🕒 Mua gần nhất: <strong>${escapeHtml(c.last_order_at || "—")}</strong></span>
        </div>
      </div>
    `;
    })
    .join("");
}

function quickOrderForCustomer(name, phone) {
  switchTab("pos");
  const nameInput = document.getElementById("pos-customer-name");
  const phoneInput = document.getElementById("pos-customer-phone");
  if (nameInput) nameInput.value = name || "";
  if (phoneInput) phoneInput.value = phone || "";
  showToast(`👉 Đã chọn khách "${name}". Hãy bấm chọn bánh khách mua!`);
  const posTable = document.querySelector(".pos-menu-card");
  if (posTable) posTable.scrollIntoView({ behavior: "smooth", block: "start" });
}

function exportCustomerCSV() {
  const customers = getCustomerDatabaseList();
  if (customers.length === 0) {
    return showToast("Chưa có dữ liệu khách hàng để xuất.", true);
  }

  const headers = ["Tên khách hàng", "Số điện thoại", "Lần mua gần nhất", "Số đơn đã mua", "Tổng bánh đã mua", "Chi tiết các bánh đã ủng hộ", "Tổng tiền đã ủng hộ (VNĐ)"];
  const rows = customers.map((c) => {
    const cakesStr = Object.entries(c.cakes_map)
      .map(([name, qty]) => `${qty}x ${name}`)
      .join("; ");

    return [
      `"${(c.name || "").replace(/"/g, '""')}"`,
      `"${(c.phone || "").replace(/"/g, '""')}"`,
      `"${c.last_order_at || ""}"`,
      c.order_count,
      c.total_cakes,
      `"${cakesStr.replace(/"/g, '""')}"`,
      Math.round(c.total_spent || 0)
    ];
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `co-so-du-lieu-khach-hang-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  logClientActivity("SETTINGS", `Xuất file Excel (CSV) cơ sở dữ liệu khách hàng (${customers.length} khách)`);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.addEventListener("DOMContentLoaded", () => {
  updateCloudStatusBadges();
  loadState();
});
