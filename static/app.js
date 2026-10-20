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
  transactions: []
};

let currentIngFilter = "all";
let currentPreviewOrder = null;

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

function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function recomputeRecipesInState(st) {
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

    r.total_cost = Math.round(totalBatchCost * 100) / 100;
    const yieldQty = Number(r.yield_qty) || 1;
    r.cost_per_cake = yieldQty > 0 ? Math.round((totalBatchCost / yieldQty) * 100) / 100 : r.total_cost;
    r.max_batches = maxBatches !== null ? maxBatches : 0;
    r.max_cakes = Math.floor(r.max_batches * yieldQty);
    r.shortages = shortages;
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
  recomputeRecipesInState(st);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(st));
}

async function apiGet(url) {
  if (!IS_VERCEL_STATIC) {
    try {
      const res = await fetch(url);
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        return await res.json();
      }
      IS_VERCEL_STATIC = true;
    } catch (e) {
      IS_VERCEL_STATIC = true;
    }
  }
  return await getLocalVercelState();
}

async function apiPost(url, payload) {
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
      ing.name = name;
      ing.category = data.category || "Bột các loại";
      ing.unit = data.unit || "kg";
      ing.stock = Number(data.stock) || 0;
      ing.min_stock = Number(data.min_stock) || 0;
      ing.package_size = pkgSize;
      ing.package_price = pkgPrice;
      ing.cost_per_unit = costPerUnit;
      ing.updated_at = now;
    } else {
      const newId = st.ingredients.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
      const stock = Number(data.stock) || 0;
      st.ingredients.push({
        id: newId,
        name,
        category: data.category || "Bột các loại",
        unit: data.unit || "kg",
        stock,
        min_stock: Number(data.min_stock) || 0,
        package_size: pkgSize,
        package_price: pkgPrice,
        cost_per_unit: costPerUnit,
        updated_at: now
      });
      st.transactions.unshift({
        id: Date.now(),
        type: "RESTOCK",
        title: `Thêm nguyên liệu mới: ${name}`,
        total_cost: Math.round(stock * costPerUnit),
        created_at: now,
        details: [{ ingredient_id: newId, name, change: `+${stock}`, raw_delta: stock, unit: data.unit || "kg" }]
      });
    }
    saveLocalVercelState(st);
    return { ok: true };
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
    st.transactions.unshift({
      id: Date.now(),
      type: "RESTOCK",
      title: `Nhập kho: ${ing.name} (+${addQty}${addUnit})`,
      total_cost: Math.round(totalPrice),
      created_at: now,
      details: [{ ingredient_id: ing.id, name: ing.name, change: `+${addQty}${addUnit}`, raw_delta: addedInStock, unit: "" }]
    });
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/ingredients/delete") {
    st.ingredients = st.ingredients.filter((x) => x.id !== Number(data.id));
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
    if (data.id) {
      const r = st.recipes.find((x) => x.id === Number(data.id));
      if (r) {
        Object.assign(r, {
          name,
          category: data.category,
          yield_qty: Number(data.yield_qty) || 1,
          yield_unit: data.yield_unit || "bánh",
          cake_weight_gram: Number(data.cake_weight_gram) || 0,
          selling_price: Number(data.selling_price) || 0,
          notes: data.notes || "",
          items,
          updated_at: now
        });
      }
    } else {
      const newId = st.recipes.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
      st.recipes.push({
        id: newId,
        name,
        category: data.category,
        yield_qty: Number(data.yield_qty) || 1,
        yield_unit: data.yield_unit || "bánh",
        cake_weight_gram: Number(data.cake_weight_gram) || 0,
        selling_price: Number(data.selling_price) || 0,
        notes: data.notes || "",
        items,
        updated_at: now
      });
    }
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/recipes/delete") {
    st.recipes = st.recipes.filter((x) => x.id !== Number(data.id));
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/bake") {
    const r = st.recipes.find((x) => x.id === Number(data.recipe_id));
    if (!r) throw new Error("Không tìm thấy công thức.");
    const batches = Number(data.batches) || 1;
    const details = [];
    let totalCost = 0;

    r.items.forEach((it) => {
      const ing = st.ingredients.find((x) => x.id === Number(it.ingredient_id));
      if (!ing) return;
      const rUnit = it.recipe_unit || ing.unit;
      const factor = convertUnitFactor(rUnit, ing.unit);
      const neededRec = Number((it.amount * batches).toFixed(2));
      const neededStock = Number((neededRec * factor).toFixed(5));
      const newStock = Number(Math.max(0, ing.stock - neededStock).toFixed(4));
      const actualDeducted = Number((ing.stock - newStock).toFixed(5));
      ing.stock = newStock;
      totalCost += neededStock * ing.cost_per_unit;
      details.push({
        ingredient_id: ing.id,
        name: ing.name,
        change: `-${neededRec}${rUnit} (-${neededStock}${ing.unit})`,
        raw_delta: -actualDeducted,
        unit: ""
      });
    });

    const title = `Làm bánh: ${r.name} (${batches * r.yield_qty} ${r.yield_unit})`;
    st.transactions.unshift({ id: Date.now(), type: "BAKE", title, total_cost: Math.round(totalCost), created_at: now, details });
    saveLocalVercelState(st);
    return { ok: true, title };
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

    const order = {
      id: Date.now() + 1,
      bill_code: `HD-${String((st.orders?.length || 0) + 1).padStart(3, "0")}`,
      customer_name,
      customer_phone: data.customer_phone || "",
      customer_note: data.customer_note || "",
      payment_method: data.payment_method || "Tiền mặt",
      items,
      subtotal,
      discount: Number(data.discount) || 0,
      shipping_fee: Number(data.shipping_fee) || 0,
      total_amount: Math.max(0, subtotal - (Number(data.discount) || 0) + (Number(data.shipping_fee) || 0)),
      total_cost: Math.round(totalCost),
      deducted_stock: data.deduct_stock ? 1 : 0,
      tx_id: data.deduct_stock ? txId : null,
      created_at: now
    };
    st.orders = st.orders || [];
    st.orders.unshift(order);
    saveLocalVercelState(st);
    return { ok: true, order };
  }

  if (path === "/api/orders/delete") {
    st.orders = (st.orders || []).filter((x) => x.id !== Number(data.id));
    saveLocalVercelState(st);
    return { ok: true };
  }

  if (path === "/api/settings/save") {
    st.shop_settings = Object.assign(st.shop_settings || {}, data);
    saveLocalVercelState(st);
    return { ok: true };
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
    st.transactions = st.transactions.filter((x) => x.id !== Number(data.id));
    saveLocalVercelState(st);
    return { ok: true };
  }

  return { ok: true };
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
        const weightBadge = r.cake_weight_gram > 0 ? ` (${formatNum(r.cake_weight_gram)}g/${escapeHtml(r.yield_unit)})` : "";
        const imgUrl = getRecipeImageUrl(r);
        const imgHtml = imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(r.name)}" class="quick-recipe-thumb" />` : "";
        return `
        <div class="quick-recipe-item">
          <div class="pos-cake-cell">
            ${imgHtml}
            <div class="quick-recipe-info">
              <h4>${escapeHtml(r.name)}${weightBadge}</h4>
              <div class="quick-recipe-meta">
                Giá bán 1 ${escapeHtml(r.yield_unit)}: <strong class="text-green">${formatVND(r.selling_price)}</strong>
                • Giá vốn 1 ${escapeHtml(r.yield_unit)}: <strong>${formatVND(r.cost_per_cake)}</strong> • ${statusBadge}
              </div>
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="btn btn-sm btn-secondary" onclick="jumpToSell(${r.id})">🧾 Bán ngay</button>
            <button class="btn btn-sm btn-primary" onclick="jumpToBake(${r.id})">🧁 Làm bánh</button>
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
    tbody.innerHTML = `<tr><td colspan="5" class="text-center muted" style="padding:24px;">Chưa có bánh nào trong danh sách. Hãy tạo bánh ở mục "Công thức & Giá vốn" hoặc bấm "+ Thêm món phụ".</td></tr>`;
  } else {
    tbody.innerHTML = STATE.recipes
      .map((r) => {
        // selling_price is already the price of 1 cake!
        const unitPrice = r.selling_price > 0 ? Math.round(r.selling_price) : Math.round((r.cost_per_cake || r.total_cost) * 2);
        const unitCost = r.cost_per_cake || r.total_cost || 0;
        const canBake = r.max_batches > 0;
        const weightInfo = r.cake_weight_gram > 0 ? ` • ${formatNum(r.cake_weight_gram)}g/${escapeHtml(r.yield_unit)}` : "";
        const imgUrl = getRecipeImageUrl(r);
        const imgHtml = imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(r.name)}" class="pos-cake-thumb" />` : "";

        return `
        <tr class="pos-item-row" data-recipe-id="${r.id}" data-name="${escapeHtml(r.name)}" data-unit="${escapeHtml(r.yield_unit)}" data-unit-cost="${unitCost}">
          <td class="text-center">
            <input type="checkbox" class="pos-check" onchange="onPosCheckChange(this)" />
          </td>
          <td onclick="toggleRowClick(event, this)" style="cursor:pointer;">
            <div class="pos-cake-cell">
              ${imgHtml}
              <div>
                <strong>${escapeHtml(r.name)}</strong>
                <div class="muted" style="font-size:12px;">
                  Đơn vị: 1 ${escapeHtml(r.yield_unit)}${weightInfo} • Giá vốn 1 ${escapeHtml(r.yield_unit)}: ${formatVND(unitCost)}
                  • ${canBake ? `<span class="text-green">Kho đủ làm ${r.max_cakes || r.max_batches} ${escapeHtml(r.yield_unit)}</span>` : `<span class="text-danger">Kho thiếu NL</span>`}
                </div>
              </div>
            </div>
          </td>
          <td class="text-right">
            <input type="number" class="pos-price-input" value="${unitPrice}" min="0" step="1000" oninput="updatePosSummary()" />
          </td>
          <td class="text-center">
            <div class="pos-qty-box">
              <button type="button" class="pos-qty-btn" onclick="stepPosQty(this, -1)">−</button>
              <input type="number" class="pos-qty-input" value="1" min="0.5" step="1" oninput="onPosQtyInput(this)" />
              <button type="button" class="pos-qty-btn" onclick="stepPosQty(this, 1)">+</button>
            </div>
          </td>
          <td class="text-right">
            <strong class="pos-line-total">0 đ</strong>
          </td>
        </tr>
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
    const check = row.querySelector(".pos-check");
    check.checked = true;
    row.classList.add("selected-row");
    updatePosSummary();
  }
}

function toggleRowClick(event, td) {
  if (event.target.tagName === "INPUT" || event.target.tagName === "BUTTON") return;
  const row = td.closest("tr");
  const check = row.querySelector(".pos-check");
  check.checked = !check.checked;
  onPosCheckChange(check);
}

function onPosCheckChange(checkbox) {
  const row = checkbox.closest("tr");
  row.classList.toggle("selected-row", checkbox.checked);
  const qtyInput = row.querySelector(".pos-qty-input");
  if (checkbox.checked && (parseFloat(qtyInput.value) || 0) <= 0) {
    qtyInput.value = 1;
  }
  updatePosSummary();
}

function stepPosQty(btn, delta) {
  const row = btn.closest("tr");
  const check = row.querySelector(".pos-check");
  const input = row.querySelector(".pos-qty-input");
  let current = parseFloat(input.value) || 0;

  if (!check.checked && delta > 0) {
    check.checked = true;
    row.classList.add("selected-row");
    current = 1;
  } else {
    current = Math.max(0, current + delta);
    if (current === 0) {
      check.checked = false;
      row.classList.remove("selected-row");
      current = 1;
    } else {
      check.checked = true;
      row.classList.add("selected-row");
    }
  }
  input.value = current;
  updatePosSummary();
}

function onPosQtyInput(input) {
  const row = input.closest("tr");
  const check = row.querySelector(".pos-check");
  const val = parseFloat(input.value) || 0;
  if (val > 0 && !check.checked) {
    check.checked = true;
    row.classList.add("selected-row");
  }
  updatePosSummary();
}

function addCustomPosRow() {
  const tbody = document.getElementById("pos-cakes-tbody");
  const tr = document.createElement("tr");
  tr.className = "pos-item-row selected-row";
  tr.dataset.recipeId = "";
  tr.dataset.unit = "cái";
  tr.dataset.unitCost = "0";
  tr.innerHTML = `
    <td class="text-center">
      <input type="checkbox" class="pos-check" checked onchange="onPosCheckChange(this)" />
    </td>
    <td>
      <input type="text" class="form-control custom-pos-name" placeholder="Nhập tên món phụ (VD: Nến sinh nhật, Hộp quà...)" oninput="updatePosSummary()" style="padding:6px 10px; font-size:13.5px;" />
    </td>
    <td class="text-right">
      <input type="number" class="pos-price-input" value="15000" min="0" step="1000" oninput="updatePosSummary()" />
    </td>
    <td class="text-center">
      <div class="pos-qty-box">
        <button type="button" class="pos-qty-btn" onclick="stepPosQty(this, -1)">−</button>
        <input type="number" class="pos-qty-input" value="1" min="1" step="1" oninput="onPosQtyInput(this)" />
        <button type="button" class="pos-qty-btn" onclick="stepPosQty(this, 1)">+</button>
      </div>
    </td>
    <td class="text-right">
      <strong class="pos-line-total">15.000 đ</strong>
    </td>
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
    const check = row.querySelector(".pos-check");
    const qty = parseFloat(row.querySelector(".pos-qty-input")?.value) || 0;
    const price = parseFloat(row.querySelector(".pos-price-input")?.value) || 0;
    const lineTotalEl = row.querySelector(".pos-line-total");

    if (check && check.checked && qty > 0) {
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
    previewEl.innerHTML = `<span class="muted">👉 Hãy tích chọn ít nhất 1 loại bánh ở bảng bên trái</span>`;
  } else {
    previewEl.innerHTML =
      `<strong>Đã chọn (${items.length} loại):</strong> ` +
      items.map((it) => `${formatNum(it.qty)} × ${escapeHtml(it.name)}`).join(", ");
  }

  document.getElementById("pos-subtotal-val").textContent = formatVND(subtotal);
  const adj = shipping - discount;
  document.getElementById("pos-adj-val").textContent = (adj >= 0 ? "+" : "") + formatVND(adj);
  document.getElementById("pos-total-val").textContent = formatVND(grandTotal);
  document.getElementById("pos-profit-val").textContent = `Giá vốn NL: ${formatVND(totalCost)} • Lãi gộp đơn này: ${formatVND(profit)}`;
}

function resetPosForm() {
  document.querySelectorAll("#pos-cakes-tbody .pos-item-row").forEach((row) => {
    if (!row.dataset.recipeId) {
      row.remove();
      return;
    }
    const check = row.querySelector(".pos-check");
    check.checked = false;
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

function renderOrdersHistory() {
  const tbody = document.getElementById("orders-history-tbody");
  if (!tbody) return;
  const orders = STATE.orders || [];

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center muted" style="padding:24px;">Chưa có đơn hàng nào được bán.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders
    .map((o) => {
      const itemsSummary = (o.items || [])
        .map((it) => `<div>• <strong>${formatNum(it.qty)}</strong> × ${escapeHtml(it.name)} (${formatVND(it.line_total)})</div>`)
        .join("");
      const profit = (o.total_amount || 0) - (o.total_cost || 0);

      return `
      <tr>
        <td>
          <strong>${escapeHtml(o.bill_code)}</strong>
          <div><span class="muted" style="font-size:11.5px;">${escapeHtml(o.payment_method)}</span></div>
        </td>
        <td class="muted" style="font-size:13px;">${escapeHtml(o.created_at)}</td>
        <td>
          <strong>${escapeHtml(o.customer_name)}</strong>
          ${o.customer_phone ? `<div class="muted" style="font-size:12.5px;">📞 ${escapeHtml(o.customer_phone)}</div>` : ""}
          ${o.customer_note ? `<div class="muted" style="font-size:12px;">📝 ${escapeHtml(o.customer_note)}</div>` : ""}
        </td>
        <td style="font-size:13px;">
          ${itemsSummary}
        </td>
        <td class="text-right"><strong>${formatVND(o.total_amount)}</strong></td>
        <td class="text-right"><strong class="text-green">+${formatVND(profit)}</strong></td>
        <td class="text-right">
          <div style="display:inline-flex; gap:6px;">
            <button class="btn btn-sm btn-primary" onclick="openBillPreviewById(${o.id}, false)">🖨️ Xem / In Bill</button>
            <button class="btn btn-sm btn-danger-ghost" onclick="deleteOrder(${o.id})">Huỷ</button>
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
    <tr>
      <td>
        <div><strong>${escapeHtml(it.name)}</strong></div>
        <div style="font-size:11.5px;">${formatNum(it.qty)} ${escapeHtml(it.unit || "")} × ${Number(it.unit_price).toLocaleString("vi-VN")}</div>
      </td>
      <td style="text-align:right; font-weight:700;">${Number(it.line_total).toLocaleString("vi-VN")}</td>
    </tr>
  `
    )
    .join("");

  return `
    <div class="rcp-header">
      <img src="/logo.jpg" alt="MỀM BARKERY" class="rcp-logo" />
      <div class="rcp-shop-name">${escapeHtml(shopName)}</div>
      ${shopAddress ? `<div style="font-size:12px; margin-top:2px;">${escapeHtml(shopAddress)}</div>` : ""}
      ${shopPhone ? `<div style="font-size:12px;">ĐT: ${escapeHtml(shopPhone)}</div>` : ""}
    </div>

    <div class="rcp-title">HÓA ĐƠN BÁN HÀNG</div>

    <div class="rcp-meta">
      <div><strong>Số Bill:</strong> ${escapeHtml(order.bill_code)}</div>
      <div><strong>Ngày giờ:</strong> ${escapeHtml(order.created_at)}</div>
      <div><strong>Khách hàng:</strong> ${escapeHtml(order.customer_name || "Khách lẻ")}</div>
      ${order.customer_phone ? `<div><strong>SĐT khách:</strong> ${escapeHtml(order.customer_phone)}</div>` : ""}
      ${order.customer_note ? `<div><strong>Ghi chú:</strong> ${escapeHtml(order.customer_note)}</div>` : ""}
      <div><strong>Thanh toán:</strong> ${escapeHtml(order.payment_method || "Tiền mặt")}</div>
    </div>

    <table class="rcp-table">
      <thead>
        <tr>
          <th>Mặt hàng (SL × Đơn giá)</th>
          <th style="text-align:right;">Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="rcp-totals">
      <div class="rcp-row">
        <span>Tạm tính:</span>
        <span>${formatVND(order.subtotal)}</span>
      </div>
      ${
        order.discount > 0
          ? `<div class="rcp-row"><span>Giảm giá:</span><span>-${formatVND(order.discount)}</span></div>`
          : ""
      }
      ${
        order.shipping_fee > 0
          ? `<div class="rcp-row"><span>Phí giao hàng:</span><span>+${formatVND(order.shipping_fee)}</span></div>`
          : ""
      }
      <div class="rcp-row rcp-grand">
        <span>TỔNG CỘNG:</span>
        <span>${formatVND(order.total_amount)}</span>
      </div>
    </div>

    <div class="rcp-footer">
      ${escapeHtml(footer)}
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

/* ==================== 3. BAKE TAB (GRAM -> KG AUTO DEDUCTION) ==================== */
function renderBakeTab(preserveRecipeId) {
  const select = document.getElementById("bake-recipe-select");
  if (STATE.recipes.length === 0) {
    select.innerHTML = `<option value="">-- Chưa có công thức bánh --</option>`;
    document.getElementById("bake-ingredients-preview").innerHTML = `<p class="muted">Vui lòng thêm công thức bánh ở mục Công thức.</p>`;
    return;
  }

  const currentVal = preserveRecipeId || select.value || STATE.recipes[0].id;
  select.innerHTML = STATE.recipes
    .map(
      (r) =>
        `<option value="${r.id}" ${String(r.id) === String(currentVal) ? "selected" : ""}>
          ${escapeHtml(r.name)} (1 mẻ = ${r.yield_qty} ${escapeHtml(r.yield_unit)} • Giá bán 1 ${escapeHtml(r.yield_unit)}: ${formatVND(r.selling_price)})
        </option>`
    )
    .join("");

  renderBakePreview();
}

function adjustBakeBatches(delta) {
  const input = document.getElementById("bake-batches-input");
  let val = parseFloat(input.value) || 1;
  val = Math.max(0.5, Math.round((val + delta) * 10) / 10);
  input.value = val;
  renderBakePreview();
}

function renderBakePreview() {
  const recipeId = Number(document.getElementById("bake-recipe-select").value);
  const batches = Math.max(0.01, parseFloat(document.getElementById("bake-batches-input").value) || 1);
  const recipe = STATE.recipes.find((r) => r.id === recipeId);
  const previewEl = document.getElementById("bake-ingredients-preview");
  const warningEl = document.getElementById("bake-shortage-warning");

  if (!recipe) {
    previewEl.innerHTML = "";
    warningEl.classList.add("hidden");
    return;
  }

  const totalCakes = batches * recipe.yield_qty;
  const weightNote = recipe.cake_weight_gram > 0 ? ` (${formatNum(recipe.cake_weight_gram)}g/${recipe.yield_unit})` : "";
  document.getElementById("bake-yield-label").textContent = `Thành phẩm thu được: ${formatNum(totalCakes)} ${recipe.yield_unit}${weightNote}`;

  const totalCost = recipe.total_cost * batches;
  const unitCost = recipe.cost_per_cake || 0;
  // selling_price is price per 1 cake!
  const expectedRev = (recipe.selling_price || 0) * totalCakes;
  const expectedProfit = expectedRev - totalCost;

  document.getElementById("bake-total-cost").textContent = formatVND(totalCost);
  document.getElementById("bake-unit-cost").textContent = `${formatVND(unitCost)} / 1 ${recipe.yield_unit}`;
  document.getElementById("bake-expected-rev").textContent =
    recipe.selling_price > 0 ? `${formatVND(expectedRev)} (${formatNum(totalCakes)} × ${formatVND(recipe.selling_price)})` : "Chưa đặt giá bán";
  document.getElementById("bake-expected-profit").textContent = recipe.selling_price > 0 ? formatVND(expectedProfit) : "—";

  let hasShortage = false;

  const rowsHtml = recipe.items
    .map((it) => {
      const rUnit = it.recipe_unit || it.ingredient_unit;
      const sUnit = it.ingredient_unit;
      const factor = convertUnitFactor(rUnit, sUnit);

      const neededInRecipeUnit = it.amount * batches;
      const neededInStockUnit = neededInRecipeUnit * factor;
      const currentStock = it.ingredient_stock;
      const remainingStock = currentStock - neededInStockUnit;
      const isShort = remainingStock < -1e-9;
      if (isShort) hasShortage = true;

      const convLabel =
        rUnit.toLowerCase() !== sUnit.toLowerCase()
          ? `<div class="muted" style="font-size:11.5px;">(= -${formatNum(neededInStockUnit)} ${escapeHtml(sUnit)} kho)</div>`
          : "";

      return `
      <tr>
        <td><strong>${escapeHtml(it.ingredient_name)}</strong></td>
        <td class="text-right">
          <strong class="text-danger">-${formatNum(neededInRecipeUnit)} ${escapeHtml(rUnit)}</strong>
          ${convLabel}
        </td>
        <td class="text-right">${formatDualStock(currentStock, sUnit)}</td>
        <td class="text-right">
          ${
            isShort
              ? `<span class="stock-pill stock-out">Thiếu ${formatDualStock(Math.abs(remainingStock), sUnit)}</span>`
              : `<span class="stock-pill stock-ok">Còn ${formatDualStock(remainingStock, sUnit)}</span>`
          }
        </td>
        <td class="text-right muted">${formatVND(neededInStockUnit * it.cost_per_unit)}</td>
      </tr>
    `;
    })
    .join("");

  previewEl.innerHTML = `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>Nguyên liệu</th>
            <th class="text-right">Định lượng cần trừ</th>
            <th class="text-right">Kho hiện có</th>
            <th class="text-right">Kho còn lại</th>
            <th class="text-right">Giá vốn</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;

  warningEl.classList.toggle("hidden", !hasShortage);
}

function jumpToBake(recipeId) {
  switchTab("bake");
  const select = document.getElementById("bake-recipe-select");
  select.value = String(recipeId);
  document.getElementById("bake-batches-input").value = 1;
  renderBakePreview();
}

async function submitBake() {
  const recipeId = Number(document.getElementById("bake-recipe-select").value);
  const batches = parseFloat(document.getElementById("bake-batches-input").value) || 0;
  const note = document.getElementById("bake-note-input").value.trim();
  const allowNegative = document.getElementById("bake-allow-negative").checked;

  if (!recipeId || batches <= 0) {
    return showToast("Vui lòng chọn bánh và nhập số mẻ hợp lệ.", true);
  }

  try {
    const res = await apiPost("/api/bake", {
      recipe_id: recipeId,
      batches,
      allow_negative: allowNegative,
      note
    });
    document.getElementById("bake-note-input").value = "";
    document.getElementById("bake-allow-negative").checked = false;
    showToast("🎉 Đã trừ kho tự động: " + res.title);
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
        subUnitPrice = `<div class="muted" style="font-size:11.5px;">(= <strong>${formatNum(i.cost_per_unit / 1000)} đ / 1g</strong>)</div>`;
      } else if (uLower === "lít" || uLower === "lit") {
        subUnitPrice = `<div class="muted" style="font-size:11.5px;">(= <strong>${formatNum(i.cost_per_unit / 1000)} đ / 1ml</strong>)</div>`;
      }

      return `
      <tr>
        <td>
          <strong>${escapeHtml(i.name)}</strong>
        </td>
        <td><span class="recipe-cat">${escapeHtml(i.category || "Chung")}</span></td>
        <td class="text-right">
          <span class="stock-pill ${statusClass}">
            ${formatDualStock(i.stock, i.unit)} (${statusLabel})
          </span>
        </td>
        <td class="text-right muted">${formatDualStock(i.min_stock, i.unit)}</td>
        <td class="text-right">
          <strong>${formatVND(i.cost_per_unit)}</strong> / ${escapeHtml(i.unit)}
          ${subUnitPrice}
        </td>
        <td class="text-right"><strong>${formatVND(totalVal)}</strong></td>
        <td class="text-right">
          <div style="display:inline-flex; gap:6px;">
            <button class="btn btn-sm btn-primary" onclick="openRestockModal(${i.id})">+ Nhập thêm</button>
            <button class="btn btn-sm btn-outline" onclick="openIngredientModal(${i.id})">Sửa</button>
            <button class="btn btn-sm btn-danger-ghost" onclick="deleteIngredient(${i.id})">Xoá</button>
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

  try {
    await apiPost("/api/ingredients/save", {
      id,
      name,
      category,
      unit,
      stock,
      min_stock,
      package_size,
      package_price
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
      const imgHtml = imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(r.name)}" class="recipe-card-img" />` : "";

      return `
      <div class="recipe-card">
        <div>
          <div class="recipe-top">
            <div class="recipe-title-box">
              ${imgHtml}
              <div>
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

/* ==================== 6. HISTORY TAB ==================== */
function renderTxItemHTML(tx, allowUndo = true) {
  const typeLabels = {
    BAKE: "🧁 Làm/Bán bánh (Trừ kho)",
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

  return `
    <div class="tx-item">
      <div>
        <div>
          <span class="tx-badge ${tx.type}">${label}</span>
          <span class="tx-title">${escapeHtml(tx.title)}</span>
        </div>
        <div class="tx-time">🕒 ${escapeHtml(tx.created_at)} ${tx.total_cost > 0 ? `• Giá vốn: <strong>${formatVND(tx.total_cost)}</strong>` : ""}</div>
        <div class="tx-pills">${pills}</div>
      </div>
      ${
        allowUndo
          ? `<button class="btn btn-sm btn-outline" onclick="undoTransaction(${tx.id})" title="Hoàn lại số lượng nguyên liệu của giao dịch này">↩️ Hoàn tác</button>`
          : ""
      }
    </div>
  `;
}

function renderHistory() {
  const container = document.getElementById("history-list");
  if (STATE.transactions.length === 0) {
    container.innerHTML = `<p class="muted">Chưa có lịch sử giao dịch nào.</p>`;
  } else {
    container.innerHTML = STATE.transactions.map((tx) => renderTxItemHTML(tx, true)).join("");
  }
}

async function undoTransaction(id) {
  if (!confirm("Bạn có muốn hoàn tác giao dịch này? Số lượng nguyên liệu trong kho sẽ được khôi phục lại như trước.")) {
    return;
  }
  try {
    await apiPost("/api/transactions/undo", { id });
    showToast("↩️ Đã hoàn tác và khôi phục số lượng tồn kho!");
    await loadState();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ==================== UTILITIES & EXPORTS ==================== */
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function openMobileModal() {
  const url = STATE.server_info?.url || window.location.origin;
  document.getElementById("mobile-url-text").textContent = url;
  const qrImg = document.getElementById("mobile-qr-img");
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  document.getElementById("modal-mobile").classList.remove("hidden");
}

function copyMobileUrl() {
  const url = document.getElementById("mobile-url-text").textContent;
  navigator.clipboard?.writeText(url);
  showToast("📋 Đã sao chép đường dẫn!");
}

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
}

function exportOrdersCSV() {
  const headers = ["Mã Bill", "Ngày giờ", "Khách hàng", "Số điện thoại", "Thanh toán", "Chi tiết bánh", "Tổng thu (VNĐ)", "Giá vốn (VNĐ)", "Lợi nhuận (VNĐ)"];
  const rows = (STATE.orders || []).map((o) => {
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
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.addEventListener("DOMContentLoaded", () => {
  loadState();
});
