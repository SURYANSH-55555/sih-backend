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
          role VARCHAR(20) NOT NULL
      );
    `);
    console.log("✅ Users table created!");

    // 2. Encrypt your admin password
    const adminPassword = "nitr769008";
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(adminPassword, saltRounds);

    // 3. Insert the Admin user
    await pool.query(`
      INSERT INTO users (login_id, password_hash, role) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (login_id) DO NOTHING;
    `, ['admin', hashedPassword, 'admin']);
    
    console.log("✅ Admin user safely encrypted and added!");
    console.log("🚀 Database setup complete. You can now log in!");
    
    process.exit(0);
  } catch (err) {
    console.error("❌ Error setting up database:", err);
    process.exit(1);
  }
}

setupDatabase();