import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const cfg = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "price_list_app",
  multipleStatements: true
};

const sqlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../database/clean-clients-products.sql"
);

const sql = await fs.readFile(sqlPath, "utf8");
const conn = await mysql.createConnection(cfg);
try {
  await conn.query(sql);
  console.log("OK: precios, clientes y productos eliminados. Formatos conservados.");
} finally {
  await conn.end();
}
