import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export let pool;

function getConfig() {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "price_list_app"
  };
}

export async function initDatabase() {
  const cfg = getConfig();
  const bootstrap = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    multipleStatements: true
  });

  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\``);
  await bootstrap.end();

  pool = mysql.createPool({
    ...cfg,
    connectionLimit: 10,
    multipleStatements: true
  });

  const schemaPath = path.resolve(__dirname, "../../../database/schema.sql");
  const seedPath = path.resolve(__dirname, "../../../database/seed.sql");
  const schemaSql = await fs.readFile(schemaPath, "utf8");
  await pool.query(schemaSql);

  const [tables] = await pool.query("SHOW TABLES LIKE 'clients'");
  if (tables.length > 0) {
    const [rows] = await pool.query("SELECT COUNT(*) AS c FROM clients");
    if (rows[0].c === 0) {
      const seedSql = await fs.readFile(seedPath, "utf8");
      await pool.query(seedSql);
    }
  }
}
