require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function upgradeDB() {
  try {
    console.log("⏳ Upgrading users table...");
    
    // This adds the full_name column to your existing table safely
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);
    `);
    
    console.log("✅ Database upgraded! Ready for new registrations.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error upgrading database:", err);
    process.exit(1);
  }
}

upgradeDB();