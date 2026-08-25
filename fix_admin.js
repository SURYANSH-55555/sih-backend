require("dotenv").config();
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function resetAdminPassword() {
  try {
    console.log("⏳ Hashing the new admin password...");
    // Hash the exact password from your UI
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash("nitr769008", saltRounds);

    console.log("⏳ Updating the live database...");
    // Overwrite whatever is in the database with the new hash
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE role = 'admin'",
      [newPasswordHash]
    );

    console.log("✅ Admin password successfully reset to nitr769008!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

resetAdminPassword();