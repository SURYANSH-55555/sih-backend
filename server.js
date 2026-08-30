require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode"); // Added QR Code Engine
const app = express();
const port = process.env.PORT || 3000;

// ==========================================
// 1. DATABASE & SECURE SESSION SETUP
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true if using HTTPS
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  }),
);

// --- REUSABLE MIDDLEWARE FOR ROLE PROTECTION ---
function requireRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === role) {
      return next();
    }
    if (role === "admin") {
      return res.redirect("/administration_login");
    }
    res.redirect("/login");
  };
}

// ==========================================
// NEW: BLOCKCHAIN LEDGER FUNCTIONS
// ==========================================

// Function to weld a new block to the chain
async function addBlockToLedger(certId, dataHash) {
  const lastBlockResult = await pool.query(
    "SELECT block_hash FROM ledger_blocks ORDER BY block_index DESC LIMIT 1",
  );

  // If it's the first certificate ever, use a genesis hash
  const previousBlockHash =
    lastBlockResult.rows.length > 0
      ? lastBlockResult.rows[0].block_hash
      : "0".repeat(64);

  // Create the new Block Hash by combining the data and the previous hash
  const blockHash = crypto
    .createHash("sha256")
    .update(`${certId}|${dataHash}|${previousBlockHash}`)
    .digest("hex");

  // Save the block to the ledger table
  await pool.query(
    `INSERT INTO ledger_blocks (cert_id, data_hash, previous_block_hash, block_hash)
     VALUES ($1, $2, $3, $4)`,
    [certId, dataHash, previousBlockHash, blockHash],
  );

  return blockHash;
}

// Function to scan the entire chain for broken links
async function verifyChainIntegrity() {
  const { rows: blocks } = await pool.query(
    "SELECT * FROM ledger_blocks ORDER BY block_index ASC",
  );

  let expectedPrevious = "0".repeat(64);

  for (const block of blocks) {
    const recomputed = crypto
      .createHash("sha256")
      .update(
        `${block.cert_id}|${block.data_hash}|${block.previous_block_hash}`,
      )
      .digest("hex");

    if (
      recomputed !== block.block_hash ||
      block.previous_block_hash !== expectedPrevious
    ) {
      return { valid: false, brokenAtBlock: block.block_index };
    }
    expectedPrevious = block.block_hash;
  }
  return { valid: true };
}

// ==========================================
// 2. PUBLIC & LANDING ROUTES
// ==========================================
app.get("/", (req, res) => {
  res.render("index");
});

// The Cryptographic Blender (Test Route)
app.get("/test-hash", function (req, res) {
  const student = {
    name: "Rahul Kumar",
    degree: "B.Tech",
    branch: "Chemical Engineering",
    year: "2027",
  };

  const dataString = JSON.stringify(student);
  const fingerprint = crypto
    .createHash("sha256")
    .update(dataString)
    .digest("hex");

  res.send({
    message: "Certificate Hashed Successfully!",
    data: student,
    sha256_hash: fingerprint,
  });
});

// ==========================================
// 3. SECURE ADMINISTRATION LOGIN
// ==========================================
app.get("/administration_login", (req, res) => {
  const showError = req.query.error === "true";
  res.render("administration_login", { error: showError });
});

app.post("/administration_login", async (req, res) => {
  const { password } = req.body;

  try {
    const query = "SELECT * FROM users WHERE role = $1";
    const result = await pool.query(query, ["admin"]);

    if (result.rows.length === 0) {
      return res.redirect("/administration_login?error=true");
    }

    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);

    if (!match) {
      return res.redirect("/administration_login?error=true");
    }

    // Secure Login Success!
    req.session.regenerate((err) => {
      if (err) return res.status(500).send("Server error.");
      req.session.user = {
        id: admin.id,
        loginId: admin.login_id,
        role: admin.role,
      };

      req.session.save((err) => {
        if (err) return res.status(500).send("Server error.");
        res.redirect("/dashboard");
      });
    });
  } catch (err) {
    console.error("Database error during admin login:", err);
    res.redirect("/administration_login?error=true");
  }
});

// ==========================================
// 4. PROTECTED ADMIN DASHBOARD ROUTES
// ==========================================
app.get("/dashboard", requireRole("admin"), (req, res) => {
  res.render("overview", { activePage: "overview" });
});

app.get("/dashboard/issue", requireRole("admin"), (req, res) => {
  res.render("issue", { activePage: "issue", credentialData: null });
});

app.post(
  ["/generate-hash", "/dashboard/issue"],
  requireRole("admin"),
  async (req, res) => {
    // UPDATED: Grab docType from the request body
    const { studentName, rollNo, gradYear, degree, branch, docType } = req.body;

    // UPDATED: Include docType in the rawData string so it is cryptographically secured
    const rawData = `${studentName}|${rollNo}|${degree}|${branch}|${gradYear}|${docType}`;
    const documentHash = crypto
      .createHash("sha256")
      .update(rawData)
      .digest("hex");
    const randomHex = crypto.randomBytes(2).toString("hex").toUpperCase();
    const certificateID = `CERT-${randomHex}`;

    try {
      // 1. INJECT the certificate permanently into your Postgres table (Added doc_type)
      await pool.query(
        `INSERT INTO certificates (cert_id, student_name, roll_no, degree, branch, grad_year, document_hash, doc_type) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          certificateID,
          studentName,
          rollNo,
          degree,
          branch,
          gradYear,
          documentHash,
          docType, // NEW VARIABLE
        ],
      );

      // 2. NEW: WELD IT TO THE BLOCKCHAIN LEDGER
      await addBlockToLedger(certificateID, documentHash);

      // 3. Generate Real QR Code linking to the scanner
      const verificationUrl = `https://eduverse-portal.up.railway.app/dashboard/verify?id=${certificateID}`;
      const qrCodeImage = await QRCode.toDataURL(verificationUrl);

      // 4. Show the Admin the successful result on the screen
      res.render("issue", {
        activePage: "issue",
        credentialData: {
          id: certificateID,
          studentName: studentName,
          rollNo: rollNo,
          degree: degree,
          branch: branch,
          gradYear: gradYear,
          docType: docType, // Pass to frontend preview
          hash: documentHash,
          qrCode: qrCodeImage,
        },
      });
    } catch (err) {
      console.error("Database error during certificate issuance:", err);
      res.status(500).send("Error saving certificate to the database.");
    }
  },
);

// NEW: ADMIN LEDGER DASHBOARD ROUTE
app.get("/dashboard/ledger", requireRole("admin"), async (req, res) => {
  const { rows: blocks } = await pool.query(
    "SELECT * FROM ledger_blocks ORDER BY block_index ASC",
  );
  const chainStatus = await verifyChainIntegrity();
  // We explicitly remap credential_id from the ledger to cert_id for the UI
  const mappedBlocks = blocks.map((block) => ({
    ...block,
    credential_id: block.cert_id,
  }));
  res.render("ledger", {
    activePage: "ledger",
    blocks: mappedBlocks,
    chainStatus,
  });
});

// ==========================================
// 5. PUBLIC VERIFICATION PORTAL
// ==========================================

app.get("/dashboard/verify", (req, res) => {
  const prefillId = req.query.id || null;
  res.render("verify", { verifiedData: null, prefillId: prefillId });
});

app.post("/verify-action", async (req, res) => {
  const selectedCertId = req.body.certId;

  try {
    const result = await pool.query(
      "SELECT * FROM certificates WHERE cert_id = $1",
      [selectedCertId],
    );

    if (result.rows.length === 0) {
      return res.render("verify", {
        verifiedData: { notFound: true, id: selectedCertId },
        prefillId: selectedCertId,
      });
    }

    const cert = result.rows[0];

    // Check if the user is simulating a tamper via the UI (if you still have that feature)
    const branchToVerify = req.body.tamperBranch || cert.branch;

    // UPDATED: Include doc_type when recomputing the hash to check for tampering
    const rawData = `${cert.student_name}|${cert.roll_no}|${cert.degree}|${branchToVerify}|${cert.grad_year}|${cert.doc_type}`;
    const recomputedHash = crypto
      .createHash("sha256")
      .update(rawData)
      .digest("hex");

    const isMatch = recomputedHash === cert.document_hash;

    // NEW: Check if the entire blockchain is still intact!
    const chainStatus = await verifyChainIntegrity();

    // Determine overall validity
    const isRevoked = cert.status === "revoked";
    const isTampered = !isMatch;
    const isValid = !isTampered && !isRevoked && chainStatus.valid;

    res.render("verify", {
      verifiedData: {
        notFound: false,
        id: cert.cert_id,
        studentName: cert.student_name,
        rollNo: cert.roll_no,
        degree: cert.degree,
        branch: branchToVerify,
        gradYear: cert.grad_year,
        docType: cert.doc_type, // Expose to the verify page
        originalHash: cert.document_hash,
        recomputedHash: recomputedHash,
        isMatch: isMatch,
        isTampered: isTampered,
        isRevoked: isRevoked,
        chainValid: chainStatus.valid,
        isValid: isValid,
        revocationReason: cert.revocation_reason,
      },
      prefillId: selectedCertId,
    });
  } catch (err) {
    console.error("Database error during verification:", err);
    res.status(500).send("Error verifying certificate.");
  }
});

// ==========================================
// 6. ADMIN REVOCATION REGISTRY (REAL DB)
// ==========================================

app.get("/dashboard/revoke", requireRole("admin"), async (req, res) => {
  try {
    // Fetch only documents where the status is 'revoked'
    const result = await pool.query(
      "SELECT * FROM certificates WHERE status = 'revoked' ORDER BY revoked_date DESC",
    );
    res.render("revoke", { activePage: "revoke", revokedList: result.rows });
  } catch (err) {
    console.error("Error loading registry:", err);
    res.status(500).send("Error loading registry.");
  }
});

app.post("/revoke-action", requireRole("admin"), async (req, res) => {
  const { certId, reason } = req.body;
  try {
    // Permanently flip the switch in the database
    await pool.query(
      "UPDATE certificates SET status = 'revoked', revocation_reason = $1, revoked_date = CURRENT_DATE WHERE cert_id = $2",
      [reason || "Academic misconduct discovered", certId],
    );
    res.redirect("/dashboard/revoke");
  } catch (err) {
    console.error("Error revoking certificate:", err);
    res.status(500).send("Error revoking certificate.");
  }
});

// ==========================================
// 7. REGISTRATION & STUDENT PORTAL
// ==========================================

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { fullName, rollNumber, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res
      .status(400)
      .json({ success: false, message: "Passwords do not match!" });
  }

  try {
    const checkUser = await pool.query(
      "SELECT * FROM users WHERE login_id = $1",
      [rollNumber],
    );

    if (checkUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "This Roll Number is already registered!",
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await pool.query(
      `
      INSERT INTO users (login_id, password_hash, role, full_name) 
      VALUES ($1, $2, $3, $4);
    `,
      [rollNumber, hashedPassword, "student", fullName],
    );

    res.status(200).json({ success: true, redirectUrl: "/login" });
  } catch (err) {
    console.error("Registration error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during registration." });
  }
});

app.get("/login", (req, res) => {
  res.render("login", { activePage: "login", error: null });
});

app.post("/login", async (req, res) => {
  const { loginId, password } = req.body;

  try {
    const query = "SELECT * FROM users WHERE login_id = $1 AND role = $2";
    const result = await pool.query(query, [loginId, "student"]);

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Student ID or password." });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Student ID or password." });
    }

    req.session.regenerate((err) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Server error." });

      req.session.user = {
        id: user.id,
        loginId: user.login_id,
        role: user.role,
      };

      req.session.save((err) => {
        if (err)
          return res
            .status(500)
            .json({ success: false, message: "Server error." });
        res.status(200).json({ success: true, redirectUrl: "/student-portal" });
      });
    });
  } catch (err) {
    console.error("Database error during student login:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.get("/student-portal", requireRole("student"), async (req, res) => {
  const currentRollNo = req.session.user.loginId;

  try {
    const userResult = await pool.query(
      "SELECT full_name FROM users WHERE login_id = $1",
      [currentRollNo],
    );
    const fullName =
      userResult.rows.length > 0 ? userResult.rows[0].full_name : currentRollNo;

    // Fetch the latest Degree or Bonafide certificate
    const latestCert = await pool.query(
      "SELECT * FROM certificates WHERE roll_no = $1 AND doc_type != 'Semester Marksheet' ORDER BY issue_date DESC LIMIT 1",
      [currentRollNo],
    );

    // Fetch the latest Semester Marksheet independently
    const latestMarksheet = await pool.query(
      "SELECT * FROM certificates WHERE roll_no = $1 AND doc_type = 'Semester Marksheet' ORDER BY issue_date DESC LIMIT 1",
      [currentRollNo],
    );

    // Combine them into a single array to pass to the view
    const displayCertificates = [];
    if (latestCert.rows.length > 0)
      displayCertificates.push(latestCert.rows[0]);
    if (latestMarksheet.rows.length > 0)
      displayCertificates.push(latestMarksheet.rows[0]);

    const studentData = {
      name: fullName,
      rollNo: currentRollNo,
      branch: "Chemical Engineering",
      gradYear: "2029",
    };

    res.render("student-portal", {
      student: studentData,
      certificates: displayCertificates,
    });
  } catch (err) {
    console.error("Database error loading portal:", err);
    res.status(500).send("Error loading your dashboard.");
  }
});

app.get("/download/:cert_id", requireRole("student"), async (req, res) => {
  const certId = req.params.cert_id;
  const currentRollNo = req.session.user.loginId;

  try {
    const certQuery = await pool.query(
      "SELECT * FROM certificates WHERE cert_id = $1 AND roll_no = $2",
      [certId, currentRollNo],
    );

    if (certQuery.rows.length === 0) {
      return res.status(403).send("Unauthorized Access or Document Not Found");
    }

    const cert = certQuery.rows[0];

    const doc = new PDFDocument({ layout: "landscape", size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${cert.cert_id}.pdf`,
    );
    doc.pipe(res);

    // Outer Border
    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke();
    doc.moveDown(1.5);

    // Header Title
    doc
      .fontSize(32)
      .text("National Institute of Technology", { align: "center" });
    doc.moveDown(0.5);

    const docTitle = cert.doc_type ? `${cert.doc_type}` : "Official Degree";
    doc.fontSize(20).fillColor("#2563eb").text(docTitle, { align: "center" });
    doc.fillColor("black");
    doc.moveDown(1.5);

    // CONDITIONAL LAYOUT: If it's a semester marksheet, render the grade table
    if (cert.doc_type === "Semester Marksheet") {
      doc.fontSize(11);

      const startY = doc.y;

      // Left-aligned column (X: 50)
      doc.text(`Student Name: ${cert.student_name}`, 50, startY);
      doc.text(`Branch: ${cert.branch}`, 50, startY + 18);
      doc.text(`Degree: ${cert.degree}`, 50, startY + 36);

      // Right-aligned column (Mirrored perfectly against the right margin at X: 50, width: 740)
      doc.text(`Roll Number: ${cert.roll_no}`, 50, startY, {
        align: "right",
        width: 740,
      });
      doc.text(`Graduation Year: ${cert.grad_year}`, 50, startY + 18, {
        align: "right",
        width: 740,
      });

      doc.y = startY + 65; // Move past the header block cleanly

      doc
        .fontSize(13)
        .text("Semester Grade Report (Demo)", { align: "center" });
      doc.moveDown(0.8);

      const tableTop = doc.y;
      doc.rect(50, tableTop, 740, 20).fill("#f1f5f9");
      doc.fillColor("black").fontSize(10);

      doc.text("Course Code", 60, tableTop + 5, { width: 100 });
      doc.text("Course Name", 180, tableTop + 5, { width: 280 });
      doc.text("Credits", 480, tableTop + 5, { width: 80 });
      doc.text("Letter Grade", 580, tableTop + 5, { width: 100 });
      doc.text("Grade Points", 680, tableTop + 5, { width: 80 });

      let rowY = tableTop + 25;
      const subjects = [
        {
          code: "CH-101",
          name: "Advanced Chemical Engineering Thermodynamics",
          credits: 4,
          grade: "A",
          points: 36,
        },
        {
          code: "CH-103",
          name: "Fluid Mechanics & Particle Dynamics",
          credits: 4,
          grade: "EX",
          points: 40,
        },
        {
          code: "MA-201",
          name: "Numerical Methods & Partial Differential Equations",
          credits: 3,
          grade: "B",
          points: 24,
        },
        {
          code: "CY-102",
          name: "Engineering Chemistry & Polymer Science",
          credits: 3,
          grade: "A",
          points: 27,
        },
        {
          code: "HS-104",
          name: "Professional Communication & Ethics",
          credits: 2,
          grade: "EX",
          points: 20,
        },
      ];

      subjects.forEach((sub) => {
        doc.text(sub.code, 60, rowY, { width: 100 });
        doc.text(sub.name, 180, rowY, { width: 280 });
        doc.text(sub.credits.toString(), 480, rowY, { width: 80 });
        doc.text(sub.grade, 580, rowY, { width: 100 });
        doc.text(sub.points.toString(), 680, rowY, { width: 80 });
        rowY += 20;
      });

      doc.moveDown(1.5);
      doc
        .fontSize(12)
        .text("SGPA: 9.15 / 10.0", 50, doc.y + 5, { align: "right" });
    } else {
      // Standard Degree Layout
      doc.moveDown(1);
      doc
        .fontSize(16)
        .text(`This certifies that ${cert.student_name}`, { align: "center" });
      doc.text(`Roll Number: ${cert.roll_no}`, { align: "center" });
      doc.moveDown(1);
      doc.text(
        `Has successfully completed the requirements for the degree of`,
        {
          align: "center",
        },
      );
      doc
        .fontSize(18)
        .text(`${cert.degree} in ${cert.branch}`, { align: "center" });
      doc.moveDown(3);
    }

    // Footer Hashes and Security IDs
    doc.fontSize(9).fillColor("gray");
    doc.text(`Document Hash: ${cert.document_hash}`, 50, 520, {
      align: "center",
      width: 740,
    });
    doc.text(`Digital Verification ID: ${cert.cert_id}`, 50, 535, {
      align: "center",
      width: 740,
    });

    doc.end();
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).send("Error generating document.");
  }
});

// ==========================================
// 8. LOGOUT & SERVER START
// ==========================================
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.listen(port, () => {
  console.log(`EduVerse Secure Server is awake and listening on port ${port}`);
});
