#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import http.server
import json
import os
import socket
import sqlite3
import urllib.parse
from datetime import datetime

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "bakery_data.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")

METRIC_FACTORS = {
    "mg": 0.001,
    "g": 1.0,
    "gram": 1.0,
    "gr": 1.0,
    "ml": 1.0,
    "mililit": 1.0,
    "lạng": 100.0,
    "kg": 1000.0,
    "ký": 1000.0,
    "kilogram": 1000.0,
    "lít": 1000.0,
    "lit": 1000.0,
    "l": 1000.0,
}


def convert_unit_factor(from_unit, to_unit):
    """
    Returns multiplier to convert `1 from_unit` into `to_unit`.
    Example: from_unit='g', to_unit='kg' -> returns 0.001 (since 1g = 0.001kg).
    Example: from_unit='g', to_unit='lít' -> returns 0.001 (1g ≈ 1ml = 0.001 lít).
    """
    u1 = (from_unit or "").strip().lower()
    u2 = (to_unit or "").strip().lower()
    if not u1 or not u2 or u1 == u2:
        return 1.0
    if u1 in METRIC_FACTORS and u2 in METRIC_FACTORS:
        return METRIC_FACTORS[u1] / METRIC_FACTORS[u2]
    return 1.0


def default_recipe_unit_for(stock_unit):
    """If warehouse is stored in kg, g, lít, or ml, default recipe input unit to g (gram)."""
    u = (stock_unit or "").strip().lower()
    if u in METRIC_FACTORS:
        return "g"
    return stock_unit or "g"


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_column(cur, table, col_name, col_def):
    cur.execute(f"PRAGMA table_info({table})")
    existing = [row["name"] for row in cur.fetchall()]
    if col_name not in existing:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}")


def log_activity(cur, action_type, description, now):
    cur.execute("""
        INSERT INTO activity_logs (action_type, description, created_at)
        VALUES (?, ?, ?)
    """, (action_type, description, now))


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'Bột các loại',
        unit TEXT NOT NULL DEFAULT 'kg',
        stock REAL NOT NULL DEFAULT 0,
        min_stock REAL NOT NULL DEFAULT 0,
        cost_per_unit REAL NOT NULL DEFAULT 0,
        package_size REAL DEFAULT 1,
        package_price REAL DEFAULT 0,
        updated_at TEXT NOT NULL
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'Bánh ngọt',
        yield_qty REAL NOT NULL DEFAULT 1,
        yield_unit TEXT NOT NULL DEFAULT 'bánh',
        cake_weight_gram REAL NOT NULL DEFAULT 0,
        selling_price REAL NOT NULL DEFAULT 0,
        image_url TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        updated_at TEXT NOT NULL
    )
    """)
    ensure_column(cur, "recipes", "cake_weight_gram", "REAL NOT NULL DEFAULT 0")
    ensure_column(cur, "recipes", "image_url", "TEXT DEFAULT ''")
    ensure_column(cur, "recipes", "baked_stock", "REAL NOT NULL DEFAULT 0")
    cur.execute("UPDATE recipes SET image_url = '/flan-gato.png' WHERE LOWER(name) LIKE '%flan%' AND (image_url IS NULL OR image_url = '')")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS recipe_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        ingredient_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        recipe_unit TEXT NOT NULL DEFAULT 'g',
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE RESTRICT
    )
    """)
    ensure_column(cur, "recipe_items", "recipe_unit", "TEXT NOT NULL DEFAULT 'g'")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, -- 'RESTOCK', 'BAKE', 'ADJUST', 'SALE'
        title TEXT NOT NULL,
        details_json TEXT NOT NULL,
        total_cost REAL DEFAULT 0,
        recipe_id INTEGER DEFAULT NULL,
        baked_qty REAL DEFAULT 0,
        created_at TEXT NOT NULL
    )
    """)
    ensure_column(cur, "transactions", "recipe_id", "INTEGER DEFAULT NULL")
    ensure_column(cur, "transactions", "baked_qty", "REAL DEFAULT 0")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_code TEXT NOT NULL,
        customer_name TEXT DEFAULT 'Khách lẻ',
        customer_phone TEXT DEFAULT '',
        customer_note TEXT DEFAULT '',
        payment_method TEXT DEFAULT 'Tiền mặt',
        items_json TEXT NOT NULL,
        subtotal REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        shipping_fee REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        deducted_stock INTEGER NOT NULL DEFAULT 0,
        tx_id INTEGER DEFAULT NULL,
        created_at TEXT NOT NULL
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS shop_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        shop_name TEXT DEFAULT 'MỀM BARKERY',
        shop_phone TEXT DEFAULT '090x.xxx.xxx',
        shop_address TEXT DEFAULT 'Bếp Bánh Thủ Công - Tươi Mới Mỗi Ngày',
        bill_footer TEXT DEFAULT 'Cảm ơn quý khách đã ủng hộ! Hẹn gặp lại ❤️',
        paper_size TEXT DEFAULT 'k80'
    )
    """)

    cur.execute("SELECT COUNT(*) as cnt FROM shop_settings")
    if cur.fetchone()["cnt"] == 0:
        cur.execute("""
            INSERT INTO shop_settings (id, shop_name, shop_phone, shop_address, bill_footer, paper_size)
            VALUES (1, 'MỀM BARKERY', '090x.xxx.xxx', 'Bếp Bánh Thủ Công - Tươi Mới Mỗi Ngày', 'Cảm ơn quý khách đã ủng hộ! Hẹn gặp lại ❤️', 'k80')
        """)

    cur.execute("SELECT COUNT(*) as cnt FROM activity_logs")
    if cur.fetchone()["cnt"] == 0:
        now_init = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_activity(cur, "SYSTEM", "Khởi tạo nhật ký thao tác cá nhân trên hệ thống MỀM BARKERY", now_init)

    # Ensure existing recipe_items have proper recipe_unit
    cur.execute("""
        SELECT ri.id, ri.recipe_unit, i.unit as stock_unit
        FROM recipe_items ri
        JOIN ingredients i ON i.id = ri.ingredient_id
    """)
    for row in cur.fetchall():
        if not row["recipe_unit"]:
            cur.execute("UPDATE recipe_items SET recipe_unit = ? WHERE id = ?", (default_recipe_unit_for(row["stock_unit"]), row["id"]))

    # Seed sample data if empty
    cur.execute("SELECT COUNT(*) as cnt FROM ingredients")
    if cur.fetchone()["cnt"] == 0:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        sample_ingredients = [
            ("Bột mì số 8 (Cake Flour)", "Bột các loại", "kg", 2.5, 0.5, 35000, 1, 35000, now),
            ("Bơ lạt Anchor", "Bơ & Phô mai", "kg", 0.8, 0.3, 260000, 1, 260000, now),
            ("Đường tinh luyện", "Đường & Chất tạo ngọt", "kg", 1.8, 0.5, 28000, 1, 28000, now),
            ("Trứng gà tươi", "Trứng", "quả", 24, 10, 3500, 10, 35000, now),
            ("Sữa tươi không đường", "Sữa & Kem béo", "lít", 1.2, 0.4, 38000, 1, 38000, now),
            ("Whipping Cream", "Sữa & Kem béo", "lít", 0.5, 0.5, 145000, 1, 145000, now),
            ("Tinh chất Vani", "Hương liệu & Màu thực phẩm", "ml", 85, 20, 650, 100, 65000, now),
        ]
        cur.executemany("""
            INSERT INTO ingredients (name, category, unit, stock, min_stock, cost_per_unit, package_size, package_price, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, sample_ingredients)

        # Sample recipe 1: Bánh Bông Lan Bơ Sữa (1 bánh 350g, giá bán 1 bánh = 85.000đ)
        cur.execute("""
            INSERT INTO recipes (name, category, yield_qty, yield_unit, cake_weight_gram, selling_price, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, ("Bánh Bông Lan Bơ Sữa (Cốt bánh 16cm)", "Bánh bông lan", 1, "bánh", 350, 85000, "Nướng 160 độ C trong 40 phút", now))
        r1_id = cur.lastrowid
        r1_items = [
            (r1_id, 1, 100, "g"),   # 100g Bột mì (trừ 0.1kg từ kho kg)
            (r1_id, 2, 40, "g"),    # 40g Bơ lạt (trừ 0.04kg từ kho kg)
            (r1_id, 3, 75, "g"),    # 75g Đường (trừ 0.075kg từ kho kg)
            (r1_id, 4, 4, "quả"),   # 4 quả Trứng gà
            (r1_id, 5, 45, "ml"),   # 45ml Sữa tươi
            (r1_id, 7, 5, "ml"),    # 5ml Vani
        ]
        cur.executemany("INSERT INTO recipe_items (recipe_id, ingredient_id, amount, recipe_unit) VALUES (?, ?, ?, ?)", r1_items)

        # Sample recipe 2: Bánh Su Kem (1 mẻ làm được 8 bánh, mỗi bánh 45g, giá bán 1 bánh = 10.000đ)
        cur.execute("""
            INSERT INTO recipes (name, category, yield_qty, yield_unit, cake_weight_gram, selling_price, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, ("Bánh Su Kem Nhân Kem Tươi", "Bánh Su kem / Éclair", 8, "bánh", 45, 10000, "1 mẻ ra 8 chiếc bánh su kem", now))
        r2_id = cur.lastrowid
        r2_items = [
            (r2_id, 1, 65, "g"),
            (r2_id, 2, 50, "g"),
            (r2_id, 3, 40, "g"),
            (r2_id, 4, 2, "quả"),
            (r2_id, 5, 100, "ml"),
            (r2_id, 6, 150, "ml"),
        ]
        cur.executemany("INSERT INTO recipe_items (recipe_id, ingredient_id, amount, recipe_unit) VALUES (?, ?, ?, ?)", r2_items)

    conn.commit()
    conn.close()


class BakeryRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/state":
            conn = get_db()
            cur = conn.cursor()

            cur.execute("SELECT * FROM ingredients ORDER BY name ASC")
            ingredients = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT * FROM recipes ORDER BY name ASC")
            recipes = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT * FROM transactions ORDER BY id DESC LIMIT 100")
            tx_rows = [dict(r) for r in cur.fetchall()]
            for tx in tx_rows:
                try:
                    tx["details"] = json.loads(tx["details_json"])
                except Exception:
                    tx["details"] = []

            cur.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 200")
            order_rows = [dict(r) for r in cur.fetchall()]
            for o in order_rows:
                try:
                    o["items"] = json.loads(o["items_json"])
                except Exception:
                    o["items"] = []

            today_prefix = datetime.now().strftime("%Y-%m-%d")

            for r in recipes:
                cur.execute("""
                    SELECT ri.id, ri.ingredient_id, ri.amount, ri.recipe_unit,
                           i.name as ingredient_name, i.unit as ingredient_unit,
                           i.stock as ingredient_stock, i.cost_per_unit
                    FROM recipe_items ri
                    JOIN ingredients i ON i.id = ri.ingredient_id
                    WHERE ri.recipe_id = ?
                """, (r["id"],))
                items = [dict(it) for it in cur.fetchall()]
                total_batch_cost = 0.0
                max_batches = None
                shortages = []

                for it in items:
                    r_unit = it.get("recipe_unit") or it["ingredient_unit"]
                    s_unit = it["ingredient_unit"]
                    it["recipe_unit"] = r_unit
                    # Factor to convert recipe_unit (e.g. 'g') to warehouse stock_unit (e.g. 'kg')
                    factor = convert_unit_factor(r_unit, s_unit)
                    stock_needed = round(it["amount"] * factor, 6)
                    item_cost = stock_needed * it["cost_per_unit"]
                    it["stock_needed"] = stock_needed
                    it["item_cost"] = round(item_cost, 2)
                    # Also calculate how much stock is available in recipe_unit (e.g. in grams)
                    inv_factor = convert_unit_factor(s_unit, r_unit)
                    it["stock_in_recipe_unit"] = round(it["ingredient_stock"] * inv_factor, 2)

                    total_batch_cost += item_cost

                    if stock_needed > 0:
                        possible = int(it["ingredient_stock"] // stock_needed)
                        if max_batches is None or possible < max_batches:
                            max_batches = possible
                        if it["ingredient_stock"] + 1e-9 < stock_needed:
                            shortages.append({
                                "ingredient_name": it["ingredient_name"],
                                "needed": it["amount"],
                                "recipe_unit": r_unit,
                                "available_stock": it["ingredient_stock"],
                                "stock_unit": s_unit,
                                "missing_in_recipe_unit": round(it["amount"] - it["stock_in_recipe_unit"], 2),
                            })

                # Calculate baked_today & sold_today for this recipe
                baked_today = 0.0
                for tx in tx_rows:
                    if tx.get("type") == "BAKE" and str(tx.get("created_at") or "").startswith(today_prefix):
                        title_str = str(tx.get("title") or "")
                        if title_str.startswith("Bán bánh"):
                            continue
                        if tx.get("recipe_id") == r["id"] and (tx.get("baked_qty") or 0) > 0:
                            baked_today += float(tx["baked_qty"])
                        elif not tx.get("recipe_id") and r["name"].lower() in title_str.lower():
                            import re
                            m = re.search(r"\(([\d\.]+)\s+", title_str)
                            if m:
                                baked_today += float(m.group(1))
                            else:
                                baked_today += float(r.get("yield_qty") or 1)

                sold_today = 0.0
                for o in order_rows:
                    if str(o.get("created_at") or "").startswith(today_prefix):
                        for o_it in (o.get("items") or []):
                            if o_it.get("recipe_id") == r["id"]:
                                sold_today += float(o_it.get("qty") or 0)

                r["items"] = items
                r["total_cost"] = round(total_batch_cost, 2)  # Giá vốn cả 1 mẻ
                yield_qty = float(r.get("yield_qty") or 1)
                r["cost_per_cake"] = round(total_batch_cost / yield_qty, 2) if yield_qty > 0 else round(total_batch_cost, 2)
                # Note: r["selling_price"] is now Giá bán 1 bánh!
                r["batch_selling_price"] = round(float(r.get("selling_price") or 0) * yield_qty, 2)
                r["max_batches"] = max_batches if max_batches is not None else 0
                r["max_cakes"] = int((max_batches or 0) * yield_qty)
                r["shortages"] = shortages
                r["baked_today"] = round(baked_today, 2)
                r["sold_today"] = round(sold_today, 2)
                calc_remaining = max(0.0, round(baked_today - sold_today, 2))
                db_baked_stock = round(float(r.get("baked_stock") or 0), 2)
                r["baked_stock"] = calc_remaining if baked_today > 0 else db_baked_stock
                r["remaining_today"] = r["baked_stock"]

            cur.execute("SELECT * FROM activity_logs ORDER BY id DESC LIMIT 200")
            activity_rows = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT * FROM shop_settings WHERE id = 1")
            shop_row = cur.fetchone()
            shop_settings = dict(shop_row) if shop_row else {}

            conn.close()

            local_ip = get_local_ip()
            self.send_json({
                "server_info": {
                    "ip": local_ip,
                    "port": PORT,
                    "url": f"http://{local_ip}:{PORT}"
                },
                "shop_settings": shop_settings,
                "ingredients": ingredients,
                "recipes": recipes,
                "orders": order_rows,
                "transactions": tx_rows,
                "activity_logs": activity_rows
            })
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            data = self.read_json()
        except Exception as e:
            return self.send_json({"error": f"Dữ liệu không hợp lệ: {e}"}, 400)

        conn = get_db()
        cur = conn.cursor()

        try:
            # 1. Create or Update Ingredient
            if path == "/api/ingredients/save":
                ing_id = data.get("id")
                name = (data.get("name") or "").strip()
                if not name:
                    return self.send_json({"error": "Vui lòng nhập tên nguyên liệu."}, 400)
                category = (data.get("category") or "Bột các loại").strip()
                unit = (data.get("unit") or "kg").strip()
                stock = float(data.get("stock") or 0)
                min_stock = float(data.get("min_stock") or 0)
                package_size = float(data.get("package_size") or 1)
                package_price = float(data.get("package_price") or 0)
                cost_per_unit = float(data.get("cost_per_unit") or 0)

                if package_size > 0 and package_price > 0:
                    cost_per_unit = package_price / package_size

                if ing_id:
                    cur.execute("SELECT * FROM ingredients WHERE id = ?", (ing_id,))
                    old = cur.fetchone()
                    if not old:
                        return self.send_json({"error": "Không tìm thấy nguyên liệu."}, 404)
                    diff = round(stock - old["stock"], 4)
                    cur.execute("""
                        UPDATE ingredients
                        SET name=?, category=?, unit=?, stock=?, min_stock=?, cost_per_unit=?, package_size=?, package_price=?, updated_at=?
                        WHERE id=?
                    """, (name, category, unit, stock, min_stock, cost_per_unit, package_size, package_price, now, ing_id))
                    if abs(diff) > 0.0001:
                        sign = "+" if diff > 0 else ""
                        cur.execute("""
                            INSERT INTO transactions (type, title, details_json, total_cost, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        """, (
                            "ADJUST",
                            f"Điều chỉnh tồn kho: {name}",
                            json.dumps([{
                                "ingredient_id": ing_id,
                                "name": name,
                                "change": f"{sign}{diff:g}",
                                "raw_delta": diff,
                                "unit": unit,
                                "after_stock": stock
                            }], ensure_ascii=False),
                            0,
                            now
                        ))
                    log_activity(cur, "INGREDIENT", f"Cập nhật nguyên liệu: {name} (Tồn: {stock:g} {unit}, Giá vốn: {round(cost_per_unit):,}đ/{unit})", now)
                else:
                    cur.execute("""
                        INSERT INTO ingredients (name, category, unit, stock, min_stock, cost_per_unit, package_size, package_price, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (name, category, unit, stock, min_stock, cost_per_unit, package_size, package_price, now))
                    new_id = cur.lastrowid
                    cur.execute("""
                        INSERT INTO transactions (type, title, details_json, total_cost, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    """, (
                        "RESTOCK",
                        f"Thêm nguyên liệu mới: {name}",
                        json.dumps([{
                            "ingredient_id": new_id,
                            "name": name,
                            "change": f"+{stock:g}",
                            "raw_delta": stock,
                            "unit": unit,
                            "after_stock": stock
                        }], ensure_ascii=False),
                        round(stock * cost_per_unit),
                        now
                    ))
                    log_activity(cur, "INGREDIENT", f"Thêm nguyên liệu mới: {name} ({stock:g} {unit})", now)
                conn.commit()
                return self.send_json({"ok": True})

            # 2. Restock (Mua thêm nguyên liệu vào kho - hỗ trợ nhập theo kg hoặc g)
            if path == "/api/ingredients/restock":
                ing_id = int(data.get("id"))
                add_qty = float(data.get("add_qty") or 0)
                add_unit = (data.get("add_unit") or "").strip()
                total_purchase_price = float(data.get("total_purchase_price") or 0)
                note = (data.get("note") or "").strip()

                if add_qty <= 0:
                    return self.send_json({"error": "Số lượng mua thêm phải lớn hơn 0."}, 400)

                cur.execute("SELECT * FROM ingredients WHERE id = ?", (ing_id,))
                ing = cur.fetchone()
                if not ing:
                    return self.send_json({"error": "Không tìm thấy nguyên liệu."}, 404)

                stock_unit = ing["unit"]
                if not add_unit:
                    add_unit = stock_unit

                # Convert add_qty from add_unit into warehouse stock_unit
                factor = convert_unit_factor(add_unit, stock_unit)
                add_qty_in_stock_unit = round(add_qty * factor, 5)

                old_stock = float(ing["stock"])
                old_cost = float(ing["cost_per_unit"])
                new_stock = round(old_stock + add_qty_in_stock_unit, 4)

                if total_purchase_price > 0 and add_qty_in_stock_unit > 0:
                    new_unit_cost = total_purchase_price / add_qty_in_stock_unit
                    if old_stock > 0 and old_cost > 0:
                        weighted_cost = ((old_stock * old_cost) + total_purchase_price) / new_stock
                    else:
                        weighted_cost = new_unit_cost
                    package_size = add_qty_in_stock_unit
                    package_price = total_purchase_price
                else:
                    weighted_cost = old_cost
                    package_size = ing["package_size"]
                    package_price = ing["package_price"]
                    total_purchase_price = round(add_qty_in_stock_unit * old_cost)

                cur.execute("""
                    UPDATE ingredients
                    SET stock=?, cost_per_unit=?, package_size=?, package_price=?, updated_at=?
                    WHERE id=?
                """, (new_stock, weighted_cost, package_size, package_price, now, ing_id))

                display_added = f"+{add_qty:g} {add_unit}"
                if add_unit.lower() != stock_unit.lower():
                    display_added += f" (= +{add_qty_in_stock_unit:g} {stock_unit})"

                title = f"Nhập kho: {ing['name']} ({display_added})"
                if note:
                    title += f" - {note}"

                cur.execute("""
                    INSERT INTO transactions (type, title, details_json, total_cost, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    "RESTOCK",
                    title,
                    json.dumps([{
                        "ingredient_id": ing_id,
                        "name": ing["name"],
                        "change": display_added,
                        "raw_delta": add_qty_in_stock_unit,
                        "unit": "",
                        "after_stock": new_stock
                    }], ensure_ascii=False),
                    round(total_purchase_price),
                    now
                ))
                log_activity(cur, "RESTOCK", title, now)
                conn.commit()
                return self.send_json({"ok": True})

            # 3. Delete Ingredient
            if path == "/api/ingredients/delete":
                ing_id = int(data.get("id"))
                cur.execute("SELECT COUNT(*) as cnt FROM recipe_items WHERE ingredient_id = ?", (ing_id,))
                if cur.fetchone()["cnt"] > 0:
                    return self.send_json({
                        "error": "Nguyên liệu này đang nằm trong công thức bánh. Vui lòng gỡ khỏi công thức bánh trước khi xóa."
                    }, 400)
                cur.execute("SELECT name FROM ingredients WHERE id = ?", (ing_id,))
                ing_row = cur.fetchone()
                ing_name = ing_row["name"] if ing_row else f"ID #{ing_id}"
                cur.execute("DELETE FROM ingredients WHERE id = ?", (ing_id,))
                log_activity(cur, "INGREDIENT", f"Xoá nguyên liệu khỏi kho: {ing_name}", now)
                conn.commit()
                return self.send_json({"ok": True})

            # 4. Save Recipe
            if path == "/api/recipes/save":
                recipe_id = data.get("id")
                name = (data.get("name") or "").strip()
                if not name:
                    return self.send_json({"error": "Vui lòng nhập tên bánh / công thức."}, 400)
                category = (data.get("category") or "Bánh ngọt").strip()
                yield_qty = float(data.get("yield_qty") or 1)
                yield_unit = (data.get("yield_unit") or "bánh").strip()
                cake_weight_gram = float(data.get("cake_weight_gram") or 0)
                selling_price = float(data.get("selling_price") or 0)  # Giá bán 1 bánh!
                image_url = (data.get("image_url") or "").strip()
                if not image_url and "flan" in name.lower():
                    image_url = "/flan-gato.png"
                notes = (data.get("notes") or "").strip()
                items = data.get("items") or []

                valid_items = []
                for it in items:
                    ing_id = int(it.get("ingredient_id") or 0)
                    amount = float(it.get("amount") or 0)
                    recipe_unit = (it.get("recipe_unit") or "g").strip()
                    if ing_id > 0 and amount > 0:
                        valid_items.append((ing_id, amount, recipe_unit))

                if not valid_items:
                    return self.send_json({"error": "Công thức cần có ít nhất 1 nguyên liệu với định lượng lớn hơn 0."}, 400)

                is_update = bool(recipe_id)
                if recipe_id:
                    cur.execute("""
                        UPDATE recipes
                        SET name=?, category=?, yield_qty=?, yield_unit=?, cake_weight_gram=?, selling_price=?, image_url=?, notes=?, updated_at=?
                        WHERE id=?
                    """, (name, category, yield_qty, yield_unit, cake_weight_gram, selling_price, image_url, notes, now, recipe_id))
                    cur.execute("DELETE FROM recipe_items WHERE recipe_id = ?", (recipe_id,))
                else:
                    cur.execute("""
                        INSERT INTO recipes (name, category, yield_qty, yield_unit, cake_weight_gram, selling_price, image_url, notes, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (name, category, yield_qty, yield_unit, cake_weight_gram, selling_price, image_url, notes, now))
                    recipe_id = cur.lastrowid

                for ing_id, amt, r_unit in valid_items:
                    cur.execute("""
                        INSERT INTO recipe_items (recipe_id, ingredient_id, amount, recipe_unit)
                        VALUES (?, ?, ?, ?)
                    """, (recipe_id, ing_id, amt, r_unit))

                action_verb = "Cập nhật công thức bánh" if is_update else "Tạo công thức bánh mới"
                log_activity(cur, "RECIPE", f"{action_verb}: {name} (Giá bán: {round(selling_price):,}đ/{yield_unit})", now)
                conn.commit()
                return self.send_json({"ok": True, "recipe_id": recipe_id})

            # 5. Delete Recipe
            if path == "/api/recipes/delete":
                recipe_id = int(data.get("id"))
                cur.execute("SELECT name FROM recipes WHERE id = ?", (recipe_id,))
                rec_row = cur.fetchone()
                rec_name = rec_row["name"] if rec_row else f"ID #{recipe_id}"
                cur.execute("DELETE FROM recipe_items WHERE recipe_id = ?", (recipe_id,))
                cur.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
                log_activity(cur, "RECIPE", f"Xoá công thức bánh: {rec_name}", now)
                conn.commit()
                return self.send_json({"ok": True})

            # 6. Bake Cake (Trừ nguyên liệu tự động từ gram sang kg kho)
            if path == "/api/bake":
                recipe_id = int(data.get("recipe_id") or 0)
                batches = float(data.get("batches") or 1)
                allow_negative = bool(data.get("allow_negative", False))
                note = (data.get("note") or "").strip()

                if batches <= 0:
                    return self.send_json({"error": "Số lượng cần làm phải lớn hơn 0."}, 400)

                cur.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
                recipe = cur.fetchone()
                if not recipe:
                    return self.send_json({"error": "Không tìm thấy công thức bánh."}, 404)

                cur.execute("""
                    SELECT ri.ingredient_id, ri.amount, ri.recipe_unit,
                           i.name, i.unit as stock_unit, i.stock, i.cost_per_unit
                    FROM recipe_items ri
                    JOIN ingredients i ON i.id = ri.ingredient_id
                    WHERE ri.recipe_id = ?
                """, (recipe_id,))
                items = cur.fetchall()
                if not items:
                    return self.send_json({"error": "Công thức bánh chưa có nguyên liệu."}, 400)

                shortages = []
                for it in items:
                    r_unit = it["recipe_unit"] or it["stock_unit"]
                    s_unit = it["stock_unit"]
                    factor = convert_unit_factor(r_unit, s_unit)
                    needed_in_recipe_unit = round(it["amount"] * batches, 2)
                    needed_in_stock_unit = round(needed_in_recipe_unit * factor, 5)
                    if it["stock"] + 1e-9 < needed_in_stock_unit:
                        shortages.append(
                            f"{it['name']} (Cần {needed_in_recipe_unit:g}{r_unit} = {needed_in_stock_unit:g}{s_unit}, kho chỉ còn {it['stock']:g}{s_unit})"
                        )

                if shortages and not allow_negative:
                    return self.send_json({
                        "error": "Không đủ nguyên liệu trong kho:\n- " + "\n- ".join(shortages),
                        "shortages": shortages
                    }, 400)

                tx_details = []
                total_cost = 0
                for it in items:
                    r_unit = it["recipe_unit"] or it["stock_unit"]
                    s_unit = it["stock_unit"]
                    factor = convert_unit_factor(r_unit, s_unit)
                    needed_in_recipe_unit = round(it["amount"] * batches, 2)
                    needed_in_stock_unit = round(needed_in_recipe_unit * factor, 5)

                    new_stock = round(max(0.0, it["stock"] - needed_in_stock_unit) if not allow_negative else (it["stock"] - needed_in_stock_unit), 4)
                    actual_deducted = round(it["stock"] - new_stock, 5)
                    total_cost += needed_in_stock_unit * it["cost_per_unit"]

                    cur.execute("""
                        UPDATE ingredients SET stock = ?, updated_at = ? WHERE id = ?
                    """, (new_stock, now, it["ingredient_id"]))

                    change_str = f"-{needed_in_recipe_unit:g}{r_unit}"
                    if r_unit.lower() != s_unit.lower():
                        change_str += f" (-{needed_in_stock_unit:g}{s_unit})"

                    tx_details.append({
                        "ingredient_id": it["ingredient_id"],
                        "name": it["name"],
                        "change": change_str,
                        "raw_delta": -actual_deducted,
                        "unit": "",
                        "after_stock": new_stock
                    })

                total_yield = round(batches * recipe["yield_qty"], 2)
                title = f"Làm bánh: {recipe['name']} ({total_yield:g} {recipe['yield_unit']})"
                if note:
                    title += f" - {note}"

                cur.execute("""
                    UPDATE recipes
                    SET baked_stock = ROUND(COALESCE(baked_stock, 0) + ?, 2), updated_at = ?
                    WHERE id = ?
                """, (total_yield, now, recipe_id))

                cur.execute("""
                    INSERT INTO transactions (type, title, details_json, total_cost, recipe_id, baked_qty, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    "BAKE",
                    title,
                    json.dumps(tx_details, ensure_ascii=False),
                    round(total_cost),
                    recipe_id,
                    total_yield,
                    now
                ))
                log_activity(cur, "BAKE", f"{title} — Đã cộng +{total_yield:g} bánh vào quầy bán & trừ nguyên liệu kho", now)

                conn.commit()
                return self.send_json({"ok": True, "title": title})

            # 7. Create Sale Order & Print Bill
            if path == "/api/orders/create":
                customer_name = (data.get("customer_name") or "").strip() or "Khách lẻ"
                customer_phone = (data.get("customer_phone") or "").strip()
                customer_note = (data.get("customer_note") or "").strip()
                payment_method = (data.get("payment_method") or "Tiền mặt").strip()
                discount = float(data.get("discount") or 0)
                shipping_fee = float(data.get("shipping_fee") or 0)
                deduct_stock = bool(data.get("deduct_stock", False))
                raw_items = data.get("items") or []

                if not raw_items:
                    return self.send_json({"error": "Vui lòng bấm chọn ít nhất 1 loại bánh trong đơn hàng."}, 400)

                order_items = []
                subtotal = 0.0
                total_cost = 0.0
                # Aggregate ingredient deductions: ing_id -> {"stock_needed": float, "gram_display": float, "r_unit": str}
                ing_deductions = {}

                for item in raw_items:
                    qty = float(item.get("qty") or 0)
                    if qty <= 0:
                        continue
                    recipe_id = item.get("recipe_id")
                    unit_price = float(item.get("unit_price") or 0)
                    item_name = (item.get("name") or "").strip()
                    unit_name = (item.get("unit") or "bánh").strip()
                    unit_cost = float(item.get("unit_cost") or 0)

                    if recipe_id:
                        cur.execute("SELECT * FROM recipes WHERE id = ?", (int(recipe_id),))
                        rec = cur.fetchone()
                        if rec:
                            if not item_name:
                                item_name = rec["name"]
                            if not unit_name:
                                unit_name = rec["yield_unit"]
                            yield_qty = float(rec["yield_qty"] or 1)
                            batches_needed = qty / yield_qty if yield_qty > 0 else qty

                            cur.execute("""
                                SELECT ri.ingredient_id, ri.amount, ri.recipe_unit,
                                       i.unit as stock_unit, i.cost_per_unit
                                FROM recipe_items ri
                                JOIN ingredients i ON i.id = ri.ingredient_id
                                WHERE ri.recipe_id = ?
                            """, (int(recipe_id),))
                            r_ings = cur.fetchall()
                            rec_batch_cost = 0.0
                            for ri in r_ings:
                                r_unit = ri["recipe_unit"] or ri["stock_unit"]
                                s_unit = ri["stock_unit"]
                                factor = convert_unit_factor(r_unit, s_unit)
                                stock_amt_per_batch = ri["amount"] * factor
                                rec_batch_cost += stock_amt_per_batch * ri["cost_per_unit"]

                                if deduct_stock:
                                    iid = ri["ingredient_id"]
                                    if iid not in ing_deductions:
                                        ing_deductions[iid] = {"stock_needed": 0.0, "recipe_needed": 0.0, "r_unit": r_unit}
                                    ing_deductions[iid]["stock_needed"] += stock_amt_per_batch * batches_needed
                                    ing_deductions[iid]["recipe_needed"] += ri["amount"] * batches_needed

                            unit_cost = rec_batch_cost / yield_qty if yield_qty > 0 else rec_batch_cost

                            # Deduct from baked_stock (số bánh đã nấu hiện còn trong ngày)
                            cur.execute("""
                                UPDATE recipes
                                SET baked_stock = MAX(0, ROUND(COALESCE(baked_stock, 0) - ?, 2))
                                WHERE id = ?
                            """, (qty, int(recipe_id)))

                    line_total = round(qty * unit_price)
                    line_cost = round(qty * unit_cost)
                    subtotal += line_total
                    total_cost += line_cost

                    order_items.append({
                        "recipe_id": recipe_id,
                        "name": item_name,
                        "unit": unit_name,
                        "qty": qty,
                        "unit_price": unit_price,
                        "unit_cost": round(unit_cost),
                        "line_total": line_total
                    })

                if not order_items:
                    return self.send_json({"error": "Số lượng bánh phải lớn hơn 0."}, 400)

                total_amount = max(0.0, subtotal - discount + shipping_fee)
                tx_id = None

                if deduct_stock and ing_deductions:
                    tx_details = []
                    for iid, d_info in ing_deductions.items():
                        needed_stock = round(d_info["stock_needed"], 5)
                        needed_rec = round(d_info["recipe_needed"], 2)
                        r_unit = d_info["r_unit"]
                        cur.execute("SELECT * FROM ingredients WHERE id = ?", (iid,))
                        ing = cur.fetchone()
                        if not ing:
                            continue
                        s_unit = ing["unit"]
                        new_stock = round(max(0.0, float(ing["stock"]) - needed_stock), 4)
                        actual_deducted = round(float(ing["stock"]) - new_stock, 5)
                        cur.execute("UPDATE ingredients SET stock = ?, updated_at = ? WHERE id = ?", (new_stock, now, iid))

                        change_str = f"-{needed_rec:g}{r_unit}"
                        if r_unit.lower() != s_unit.lower():
                            change_str += f" (-{needed_stock:g}{s_unit})"

                        tx_details.append({
                            "ingredient_id": iid,
                            "name": ing["name"],
                            "change": change_str,
                            "raw_delta": -actual_deducted,
                            "unit": "",
                            "after_stock": new_stock
                        })

                    if tx_details:
                        summary_names = ", ".join(f"{it['qty']:g} {it['name']}" for it in order_items)
                        cur.execute("""
                            INSERT INTO transactions (type, title, details_json, total_cost, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        """, (
                            "BAKE",
                            f"Bán bánh ({customer_name}): {summary_names}",
                            json.dumps(tx_details, ensure_ascii=False),
                            round(total_cost),
                            now
                        ))
                        tx_id = cur.lastrowid

                cur.execute("SELECT COUNT(*) as cnt FROM orders")
                next_num = cur.fetchone()["cnt"] + 1
                date_prefix = datetime.now().strftime("%d%m")
                bill_code = f"HD{date_prefix}-{next_num:03d}"

                cur.execute("""
                    INSERT INTO orders (
                        bill_code, customer_name, customer_phone, customer_note,
                        payment_method, items_json, subtotal, discount, shipping_fee,
                        total_amount, total_cost, deducted_stock, tx_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    bill_code, customer_name, customer_phone, customer_note,
                    payment_method, json.dumps(order_items, ensure_ascii=False),
                    round(subtotal), round(discount), round(shipping_fee),
                    round(total_amount), round(total_cost),
                    1 if deduct_stock else 0, tx_id, now
                ))
                order_id = cur.lastrowid

                cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                created_order = dict(cur.fetchone())
                created_order["items"] = order_items

                summary_names = ", ".join(f"{it['qty']:g} {it['name']}" for it in order_items)
                log_activity(cur, "ORDER", f"Tạo đơn bán bánh {bill_code} ({customer_name}): {summary_names} — Tổng: {round(total_amount):,}đ", now)

                conn.commit()
                return self.send_json({"ok": True, "order": created_order})

            # 8. Delete / Cancel Order
            if path == "/api/orders/delete":
                order_id = int(data.get("id") or 0)
                cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                order = cur.fetchone()
                if not order:
                    return self.send_json({"error": "Không tìm thấy đơn hàng."}, 404)

                # Restore baked_stock for cancelled order items
                try:
                    ord_items = json.loads(order["items_json"])
                    for o_it in ord_items:
                        r_id = o_it.get("recipe_id")
                        q = float(o_it.get("qty") or 0)
                        if r_id and q > 0:
                            cur.execute("""
                                UPDATE recipes
                                SET baked_stock = ROUND(COALESCE(baked_stock, 0) + ?, 2)
                                WHERE id = ?
                            """, (q, int(r_id)))
                except Exception:
                    pass

                if order["tx_id"]:
                    cur.execute("SELECT * FROM transactions WHERE id = ?", (order["tx_id"],))
                    tx = cur.fetchone()
                    if tx:
                        details = json.loads(tx["details_json"])
                        for item in details:
                            ing_id = item.get("ingredient_id")
                            raw_delta = item.get("raw_delta")
                            if ing_id is not None and raw_delta is not None:
                                cur.execute("""
                                    UPDATE ingredients
                                    SET stock = ROUND(stock - ?, 4), updated_at = ?
                                    WHERE id = ?
                                """, (float(raw_delta), now, int(ing_id)))
                        cur.execute("DELETE FROM transactions WHERE id = ?", (order["tx_id"],))

                bill_code = order["bill_code"]
                cust_name = order["customer_name"]
                cur.execute("DELETE FROM orders WHERE id = ?", (order_id,))
                log_activity(cur, "ORDER", f"Xoá đơn hàng {bill_code} ({cust_name})", now)
                conn.commit()
                return self.send_json({"ok": True})

            # 9. Save Shop Settings for Bill Printing
            if path == "/api/settings/save":
                shop_name = (data.get("shop_name") or "MỀM BARKERY").strip()
                shop_phone = (data.get("shop_phone") or "").strip()
                shop_address = (data.get("shop_address") or "").strip()
                bill_footer = (data.get("bill_footer") or "").strip()
                paper_size = (data.get("paper_size") or "k80").strip()

                cur.execute("""
                    UPDATE shop_settings
                    SET shop_name=?, shop_phone=?, shop_address=?, bill_footer=?, paper_size=?
                    WHERE id = 1
                """, (shop_name, shop_phone, shop_address, bill_footer, paper_size))
                log_activity(cur, "SETTINGS", f"Cập nhật thông tin cửa hàng trên bill: {shop_name}", now)
                conn.commit()
                return self.send_json({"ok": True})

            # 10. Undo Transaction (Reverts stock + removes transaction)
            if path == "/api/transactions/undo":
                tx_id = int(data.get("id") or 0)
                cur.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,))
                tx = cur.fetchone()
                if not tx:
                    return self.send_json({"error": "Không tìm thấy lịch sử giao dịch."}, 404)

                details = json.loads(tx["details_json"])
                for item in details:
                    ing_id = item.get("ingredient_id")
                    raw_delta = item.get("raw_delta")
                    if ing_id is not None and raw_delta is not None:
                        cur.execute("""
                            UPDATE ingredients
                            SET stock = ROUND(stock - ?, 4), updated_at = ?
                            WHERE id = ?
                        """, (float(raw_delta), now, int(ing_id)))

                if tx["type"] == "BAKE" and tx["recipe_id"] and (tx["baked_qty"] or 0) > 0:
                    cur.execute("""
                        UPDATE recipes
                        SET baked_stock = MAX(0, ROUND(COALESCE(baked_stock, 0) - ?, 2))
                        WHERE id = ?
                    """, (float(tx["baked_qty"]), int(tx["recipe_id"])))

                tx_title = tx["title"]
                cur.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
                log_activity(cur, "UNDO", f"Hoàn tác giao dịch kho (đã cộng/trừ lại tồn kho): {tx_title}", now)
                conn.commit()
                return self.send_json({"ok": True})

            # 11. Delete Warehouse History (Selective or All - without reverting stock)
            if path == "/api/transactions/delete":
                delete_all = bool(data.get("all", False))
                ids = data.get("ids") or []
                if delete_all:
                    cur.execute("SELECT COUNT(*) as cnt FROM transactions")
                    cnt = cur.fetchone()["cnt"]
                    cur.execute("DELETE FROM transactions")
                    log_activity(cur, "HISTORY", f"Xoá toàn bộ lịch sử biến động kho ({cnt} mục)", now)
                else:
                    clean_ids = [int(x) for x in ids if str(x).isdigit() or isinstance(x, int)]
                    if not clean_ids:
                        return self.send_json({"error": "Vui lòng chọn ít nhất 1 lịch sử kho để xoá."}, 400)
                    placeholders = ",".join("?" for _ in clean_ids)
                    cur.execute(f"DELETE FROM transactions WHERE id IN ({placeholders})", clean_ids)
                    log_activity(cur, "HISTORY", f"Xoá tuỳ chọn {len(clean_ids)} mục trong lịch sử biến động kho", now)
                conn.commit()
                return self.send_json({"ok": True})

            # 12. Record Custom Personal Activity Log from Frontend
            if path == "/api/activity/log":
                action_type = (data.get("action_type") or "ACTION").strip()
                description = (data.get("description") or "").strip()
                if description:
                    log_activity(cur, action_type, description, now)
                    conn.commit()
                return self.send_json({"ok": True})

            # 13. Delete Personal Activity Logs (Selective or All)
            if path == "/api/activity/delete":
                delete_all = bool(data.get("all", False))
                ids = data.get("ids") or []
                if delete_all:
                    cur.execute("DELETE FROM activity_logs")
                else:
                    clean_ids = [int(x) for x in ids if str(x).isdigit() or isinstance(x, int)]
                    if not clean_ids:
                        return self.send_json({"error": "Vui lòng chọn ít nhất 1 nhật ký thao tác để xoá."}, 400)
                    placeholders = ",".join("?" for _ in clean_ids)
                    cur.execute(f"DELETE FROM activity_logs WHERE id IN ({placeholders})", clean_ids)
                conn.commit()
                return self.send_json({"ok": True})

            return self.send_json({"error": "Không tìm thấy API."}, 404)
        except Exception as e:
            conn.rollback()
            return self.send_json({"error": str(e)}, 500)
        finally:
            conn.close()


if __name__ == "__main__":
    os.makedirs(STATIC_DIR, exist_ok=True)
    init_db()
    local_ip = get_local_ip()
    print("=" * 60)
    print("🍰 PHẦN MỀM QUẢN LÝ NGUYÊN LIỆU & BÁN BÁNH ĐÃ KHỞI ĐỘNG!")
    print(f"💻 Truy cập trên máy Mac này : http://localhost:{PORT}")
    print(f"📱 Truy cập trên Điện thoại  : http://{local_ip}:{PORT}")
    print("   (Lưu ý: Điện thoại và máy Mac cần bắt chung 1 mạng Wi-Fi)")
    print("=" * 60)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), BakeryRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã tắt phần mềm.")
        server.server_close()
