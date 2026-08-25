require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function addStudents() {
  try {
    console.log("⏳ Encrypting student passwords...");
    
    const saltRounds = 10;
    const defaultPassword = "studentpass"; // They will use this to log in
    const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);

    // Insert Utkarsh
    await pool.query(`
      INSERT INTO users (login_id, password_hash, role) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (login_id) DO NOTHING;
    `, ['125CH0053', hashedPassword, 'student']);

    // Insert Swayam
    await pool.query(`
      INSERT INTO users (login_id, password_hash, role) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (login_id) DO NOTHING;
    `, ['125CH0059', hashedPassword, 'student']);
    
    console.log("✅ Students 125CH0053 and 125CH0059 safely added!");
    console.log("🚀 You can now test the student login with password: studentpass");
    
    process.exit(0);
  } catch (err) {
    console.error("❌ Error setting up students:", err);
    process.exit(1);
  }
}

addStudents();