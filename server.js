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
    const { studentName, rollNo, gradYear, degree, branch } = req.body;

    const rawData = `${studentName}|${rollNo}|${degree}|${branch}|${gradYear}`;
    const documentHash = crypto
      .createHash("sha256")
      .update(rawData)
      .digest("hex");
    const randomHex = crypto.randomBytes(2).toString("hex").toUpperCase();
    const certificateID = `CERT-${randomHex}`;

    try {
      // 1. INJECT the certificate permanently into your Postgres table
      // Note: 'status' defaults to 'valid' via our Postgres schema update
      await pool.query(
        `INSERT INTO certificates (cert_id, student_name, roll_no, degree, branch, grad_year, document_hash) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          certificateID,
          studentName,
          rollNo,
          degree,
          branch,
          gradYear,
          documentHash,
        ],
      );

      // 2. Generate Real QR Code linking to the scanner
      const verificationUrl = `https://eduverse-portal.up.railway.app/dashboard/verify?id=${certificateID}`;
      const qrCodeImage = await QRCode.toDataURL(verificationUrl);

      // 3. Show the Admin the successful result on the screen
      res.render("issue", {
        activePage: "issue",
        credentialData: {
          id: certificateID,
          studentName: studentName,
          rollNo: rollNo,
          degree: degree,
          branch: branch,
          gradYear: gradYear,
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
    const rawData = `${cert.student_name}|${cert.roll_no}|${cert.degree}|${cert.branch}|${cert.grad_year}`;
    const recomputedHash = crypto
      .createHash("sha256")
      .update(rawData)
      .digest("hex");

    const isMatch = recomputedHash === cert.document_hash;

    res.render("verify", {
      verifiedData: {
        notFound: false,
        id: cert.cert_id,
        studentName: cert.student_name,
        rollNo: cert.roll_no,
        degree: cert.degree,
        branch: cert.branch,
        gradYear: cert.grad_year,
        originalHash: cert.document_hash,
        recomputedHash: recomputedHash,
        isMatch: isMatch,
        isRevoked: cert.status === "revoked", // THE NEW KILL SWITCH CHECK
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

    const certResult = await pool.query(
      "SELECT * FROM certificates WHERE roll_no = $1 ORDER BY issue_date DESC",
      [currentRollNo],
    );

    const studentData = {
      name: fullName,
      rollNo: currentRollNo,
      branch: "Chemical Engineering",
      gradYear: "2029",
    };

    res.render("student-portal", {
      student: studentData,
      certificates: certResult.rows,
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

    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke();
    doc.moveDown(2);
    doc
      .fontSize(35)
      .text("National Institute of Technology", { align: "center" });
    doc.moveDown(1);
    doc.fontSize(20).text("Official Degree Certificate", { align: "center" });
    doc.moveDown(2);
    doc
      .fontSize(16)
      .text(`This certifies that ${cert.student_name}`, { align: "center" });
    doc.text(`Roll Number: ${cert.roll_no}`, { align: "center" });
    doc.moveDown(1);
    doc.text(`Has successfully completed the requirements for the degree of`, {
      align: "center",
    });
    doc
      .fontSize(18)
      .text(`${cert.degree} in ${cert.branch}`, { align: "center" });
    doc.moveDown(3);

    doc
      .fontSize(10)
      .fillColor("gray")
      .text(`Document Hash: ${cert.document_hash}`, { align: "center" });
    doc.text(`Digital Verification ID: ${cert.cert_id}`, { align: "center" });

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
