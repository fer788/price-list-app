import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDatabase, pool } from "./db.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use(cors());
app.use(express.json());

app.get("/api/health", asyncHandler(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
}));

app.get("/api/grid", asyncHandler(async (req, res) => {
  const listType = req.query.listType || "base";

  const [clients] = await pool.query(
    "SELECT id, name, list_type FROM clients WHERE list_type = ? ORDER BY name ASC",
    [listType]
  );

  // Una columna por producto (sin repetir por cada formato).
  const [columns] = await pool.query(
    `SELECT MIN(p.id) AS product_id, p.name AS product_name
     FROM products p
     GROUP BY p.name
     ORDER BY p.name ASC`
  );

  const [prices] = await pool.query(
    `SELECT pr.client_id, p.name AS product_name, pr.price, pr.effective_date
     FROM prices pr
     INNER JOIN clients c ON c.id = pr.client_id
     INNER JOIN products p ON p.id = pr.product_id
     WHERE c.list_type = ?
     ORDER BY pr.effective_date DESC`,
    [listType]
  );

  const priceMap = new Map();
  for (const row of prices) {
    const key = `${row.client_id}:${row.product_name}`;
    const existing = priceMap.get(key);
    if (!existing || new Date(row.effective_date) > new Date(existing.effective_date)) {
      priceMap.set(key, row);
    }
  }

  const matrix = clients.map((client) => {
    const cells = {};
    for (const col of columns) {
      const key = `${client.id}:${col.product_name}`;
      const value = priceMap.get(key);
      cells[`p_${col.product_id}`] = {
        price: value ? Number(value.price) : null,
        effectiveDate: value ? value.effective_date : null
      };
    }
    return { client, cells };
  });

  return res.json({
    listType,
    columns: columns.map((c) => ({
      key: `p_${c.product_id}`,
      productId: c.product_id,
      product: c.product_name
    })),
    rows: matrix
  });
}));

app.get("/api/clients", asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT id, external_id AS externalId, name, list_type AS listType FROM clients ORDER BY name ASC"
  );
  return res.json(rows);
}));

app.post("/api/clients", asyncHandler(async (req, res) => {
  const { externalId, name, listType } = req.body;
  if (!externalId || !name || !listType) {
    return res.status(400).json({ error: "externalId, name and listType are required" });
  }
  const [result] = await pool.query(
    "INSERT INTO clients (external_id, name, list_type) VALUES (?, ?, ?)",
    [externalId, name, listType]
  );
  return res.json({ ok: true, id: result.insertId });
}));

app.put("/api/clients/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { externalId, name, listType } = req.body;
  if (!externalId || !name || !listType) {
    return res.status(400).json({ error: "externalId, name and listType are required" });
  }
  await pool.query(
    "UPDATE clients SET external_id = ?, name = ?, list_type = ? WHERE id = ?",
    [externalId, name, listType, id]
  );
  return res.json({ ok: true });
}));

app.delete("/api/clients/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM clients WHERE id = ?", [id]);
  return res.json({ ok: true });
}));

app.get("/api/products", asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT
       MIN(id) AS id,
       MAX(external_id) AS externalId,
       name
     FROM products
     GROUP BY name
     ORDER BY name ASC`
  );
  return res.json(rows);
}));

app.post("/api/products", asyncHandler(async (req, res) => {
  const { externalId, name } = req.body;
  if (!externalId || !name) {
    return res.status(400).json({ error: "externalId and name are required" });
  }
  const [result] = await pool.query(
    "INSERT INTO products (external_id, name) VALUES (?, ?)",
    [externalId, name]
  );
  return res.json({ ok: true, id: result.insertId });
}));

app.put("/api/products/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { externalId, name } = req.body;
  if (!externalId || !name) {
    return res.status(400).json({ error: "externalId and name are required" });
  }
  await pool.query(
    "UPDATE products SET external_id = ?, name = ? WHERE id = ?",
    [externalId, name, id]
  );
  return res.json({ ok: true });
}));

app.delete("/api/products/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM products WHERE id = ?", [id]);
  return res.json({ ok: true });
}));

app.post("/api/update", asyncHandler(async (req, res) => {
  const { clientId, productId, formatId, price, effectiveDate } = req.body;

  if (!clientId || !productId || typeof price !== "number") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  let resolvedFormatId = formatId;
  if (!resolvedFormatId) {
    const [[fmt]] = await pool.query("SELECT id FROM formats ORDER BY id ASC LIMIT 1");
    if (!fmt) {
      return res.status(500).json({ error: "No formats in database" });
    }
    resolvedFormatId = fmt.id;
  }

  const date = effectiveDate || new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO prices (client_id, product_id, format_id, price, effective_date)
     VALUES (?, ?, ?, ?, ?)`,
    [clientId, productId, resolvedFormatId, price, date]
  );

  return res.json({ ok: true });
}));

app.post("/api/increase", asyncHandler(async (req, res) => {
  const { listType = "base", percentage, effectiveDate } = req.body;
  if (typeof percentage !== "number") {
    return res.status(400).json({ error: "percentage must be a number" });
  }

  const date = effectiveDate || new Date().toISOString().slice(0, 10);
  const multiplier = 1 + percentage / 100;

  await pool.query(
    `INSERT INTO prices (client_id, product_id, format_id, price, effective_date)
     SELECT r.client_id, r.product_id, r.format_id, ROUND(r.price * ?, 2), ?
     FROM (
       SELECT client_id, product_id, format_id, price, effective_date,
         ROW_NUMBER() OVER (
           PARTITION BY client_id, product_id
           ORDER BY effective_date DESC, format_id ASC
         ) AS rn
       FROM prices pr
       INNER JOIN clients c ON c.id = pr.client_id
       WHERE c.list_type = ?
     ) r
     WHERE r.rn = 1`,
    [multiplier, date, listType]
  );

  return res.json({ ok: true });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  return res.status(500).json({ error: "Internal server error", detail: err.message });
});

initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend running at http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
