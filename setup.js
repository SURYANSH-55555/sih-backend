require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function setupDatabase() {
  try {
    console.log("⏳ Connecting to Railway Postgres...");

    // 1. Create the Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          login_id VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL,
          full_name VARCHAR(100)
      );
    `);
    console.log("✅ Users table ensured!");

    // 2. Create the Certificates Table (Your original table structure)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS certificates (
          cert_id VARCHAR(50) PRIMARY KEY,
          student_name VARCHAR(100) NOT NULL,
          roll_no VARCHAR(50) NOT NULL,
          degree VARCHAR(50) NOT NULL,
          branch VARCHAR(100) NOT NULL,
          grad_year VARCHAR(10) NOT NULL,
          document_hash VARCHAR(255) NOT NULL,
          status VARCHAR(20) DEFAULT 'valid',
          revocation_reason TEXT,
          revoked_date DATE,
          issue_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Certificates table ensured!");

    // 3. Create the NEW Ledger Blocks Table (The Blockchain)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ledger_blocks (
          block_index SERIAL PRIMARY KEY,
          cert_id VARCHAR(50) REFERENCES certificates(cert_id) ON DELETE CASCADE,
          data_hash VARCHAR(255) NOT NULL,
          previous_block_hash VARCHAR(255) NOT NULL,
          block_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Ledger Blocks (Blockchain) table created!");

    // 4. Encrypt your admin password
    const adminPassword = "nitr769008";
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(adminPassword, saltRounds);

    // 5. Insert the Admin user
    await pool.query(
      `
      INSERT INTO users (login_id, password_hash, role) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (login_id) DO NOTHING;
    `,
      ["admin", hashedPassword, "admin"],
    );

    console.log("✅ Admin user safely encrypted and added!");
    console.log("🚀 Database setup complete. Your blockchain is ready!");

    process.exit(0);
  } catch (err) {
    console.error("❌ Error setting up database:", err);
    process.exit(1);
  }
}

setupDatabase();
