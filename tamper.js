require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const certId = process.argv[2];
const newBranch = process.argv[3];

if (!certId || !newBranch) {
  console.log("Usage: node tamper.js <certificateId> <newBranch>");
  process.exit(1);
}

async function tamper() {
  // FIXED: Changed 'credentials' to 'certificates' and 'id' to 'cert_id'
  const result = await pool.query(
    "UPDATE certificates SET branch = $1 WHERE cert_id = $2 RETURNING *",
    [newBranch, certId],
  );

  if (result.rowCount === 0) {
    console.log(`❌ No credential found with id ${certId}`);
  } else {
    console.log(`⚠️  Tampered! ${certId} branch changed to "${newBranch}"`);
    console.log(result.rows[0]);
  }

  process.exit(0);
}

tamper();
