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

  const [columns] = await pool.query(
    `SELECT p.id AS product_id, p.name AS product_name, f.id AS format_id, f.description AS format_description
     FROM products p
     CROSS JOIN formats f
     ORDER BY p.name ASC, f.description ASC`
  );

  const [prices] = await pool.query(
    `SELECT pr.client_id, pr.product_id, pr.format_id, pr.price, pr.effective_date
     FROM prices pr
     INNER JOIN clients c ON c.id = pr.client_id
     WHERE c.list_type = ?`,
    [listType]
  );

  const priceMap = new Map();
  for (const row of prices) {
    const key = `${row.client_id}:${row.product_id}:${row.format_id}`;
    const existing = priceMap.get(key);
    if (!existing || new Date(row.effective_date) > new Date(existing.effective_date)) {
      priceMap.set(key, row);
    }
  }

  const matrix = clients.map((client) => {
    const cells = {};
    for (const col of columns) {
      const key = `${client.id}:${col.product_id}:${col.format_id}`;
      const value = priceMap.get(key);
      cells[`${col.product_id}_${col.format_id}`] = {
        price: value ? Number(value.price) : null,
        effectiveDate: value ? value.effective_date : null
      };
    }
    return { client, cells };
  });

  return res.json({
    listType,
    columns: columns.map((c) => ({
      key: `${c.product_id}_${c.format_id}`,
      productId: c.product_id,
      formatId: c.format_id,
      product: c.product_name,
      format: c.format_description
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
    "SELECT id, external_id AS externalId, name FROM products ORDER BY name ASC"
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

  if (!clientId || !productId || !formatId || typeof price !== "number") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const date = effectiveDate || new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO prices (client_id, product_id, format_id, price, effective_date)
     VALUES (?, ?, ?, ?, ?)`,
    [clientId, productId, formatId, price, date]
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
     SELECT latest.client_id, latest.product_id, latest.format_id, ROUND(latest.price * ?, 2), ?
     FROM (
       SELECT p1.client_id, p1.product_id, p1.format_id, p1.price
       FROM prices p1
       INNER JOIN (
         SELECT p.client_id, p.product_id, p.format_id, MAX(p.effective_date) AS max_date
         FROM prices p
         INNER JOIN clients c ON c.id = p.client_id
         WHERE c.list_type = ?
         GROUP BY p.client_id, p.product_id, p.format_id
       ) latest_dates
       ON p1.client_id = latest_dates.client_id
       AND p1.product_id = latest_dates.product_id
       AND p1.format_id = latest_dates.format_id
       AND p1.effective_date = latest_dates.max_date
     ) latest`,
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
