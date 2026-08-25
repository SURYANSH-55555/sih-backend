require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const path = require("path");

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
// 2. ORIGINAL IN-MEMORY DEMO DATA
// ==========================================
let revokedList = [
  {
    id: "CERT-REV991",
    studentName: "Aman Verma",
    rollNo: "2019CS0231",
    degree: "B.Tech",
    branch: "Civil Engineering",
    revokedDate: "2025-10-14",
    reason: "Administrative Discrepancy",
  },
  {
    id: "CERT-REV404",
    studentName: "Priya Sharma",
    rollNo: "2020EE0114",
    degree: "B.Tech",
    branch: "Electrical Engineering",
    revokedDate: "2026-01-02",
    reason: "Duplicate Issuance",
  },
];

// ==========================================
// 3. PUBLIC & LANDING ROUTES
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
// 4. SECURE ADMINISTRATION LOGIN
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
// 5. PROTECTED ADMIN DASHBOARD ROUTES
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
      // 1. INJECT the certificate permanently into your new Postgres table
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

      // 2. Show the Admin the successful result on the screen
      res.render("issue", {
        activePage: "issue",
        credentialData: {
          id: certificateID,
          studentName: studentName,
          hash: documentHash,
        },
      });
    } catch (err) {
      console.error("Database error during certificate issuance:", err);
      res.status(500).send("Error saving certificate to the database.");
    }
  },
);

app.get("/dashboard/verify", requireRole("admin"), (req, res) => {
  res.render("verify", { activePage: "verify", verifiedData: null });
});

app.post("/verify-action", requireRole("admin"), (req, res) => {
  const selectedCertId = req.body.certId;
  let mockVerifiedData;

  if (selectedCertId === "CERT-KQ26MQ") {
    mockVerifiedData = {
      id: "CERT-KQ26MQ",
      studentName: "Utkarsh Tripathi",
      rollNo: "125CH0053",
      degree: "B.Tech",
      branch: req.body.tamperBranch || "Chemical Engineering",
      gradYear: "2029",
      originalHash: "34c7dae40c985594f91ff1ee...2745db7b5e6f",
      recomputedHash: "34c7dae40c985594f91ff1ee...2745db7b5e6f",
    };
  } else {
    mockVerifiedData = {
      id: "CERT-L55EFV",
      studentName: "Jane Doe",
      rollNo: "2020CS0112",
      degree: "B.S. Computer Science",
      branch: req.body.tamperBranch || "Computer Science",
      gradYear: "2026",
      originalHash: "640b259edc9c4946e363686b...e2e202b34417",
      recomputedHash: "640b259edc9c4946e363686b...e2e202b34417",
    };
  }

  res.render("verify", {
    activePage: "verify",
    verifiedData: mockVerifiedData,
  });
});

app.get("/dashboard/revoke", requireRole("admin"), (req, res) => {
  res.render("revoke", { activePage: "revoke", revokedList: revokedList });
});

app.post("/revoke-action", requireRole("admin"), (req, res) => {
  const { certId, reason } = req.body;
  const existingIndex = revokedList.findIndex((item) => item.id === certId);

  if (existingIndex === -1) {
    let studentName = "Rahul Kumar";
    let rollNo = "2021CS0456";

    if (certId === "CERT-L55EFV") {
      studentName = "Jane Doe";
      rollNo = "2020CS0112";
    }

    revokedList.unshift({
      id: certId || "CERT-KQ26MQ",
      studentName: studentName,
      rollNo: rollNo,
      degree: "B.Tech",
      branch: "Chemical Engineering",
      revokedDate: new Date().toISOString().split("T")[0],
      reason: reason || "Academic misconduct discovered",
    });
  }
  res.redirect("/dashboard/revoke");
});

// 1. Serve the Create Account page
app.get("/register", (req, res) => {
  res.render("register");
});

// 2. Handle the Registration Form Submission
app.post("/register", async (req, res) => {
  const { fullName, rollNumber, password, confirmPassword } = req.body;

  // Security check: Make sure passwords match before hitting the database
  if (password !== confirmPassword) {
    return res
      .status(400)
      .json({ success: false, message: "Passwords do not match!" });
  }

  try {
    // Check if the Roll Number already exists in the database
    const checkUser = await pool.query(
      "SELECT * FROM users WHERE login_id = $1",
      [rollNumber],
    );

    if (checkUser.rows.length > 0) {
      // User exists! Change nothing and send an error back.
      return res.status(400).json({
        success: false,
        message: "This Roll Number is already registered!",
      });
    }

    // User is new! Encrypt the password and save them.
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await pool.query(
      `
      INSERT INTO users (login_id, password_hash, role, full_name) 
      VALUES ($1, $2, $3, $4);
    `,
      [rollNumber, hashedPassword, "student", fullName],
    );

    // Send a success signal back to the frontend
    res.status(200).json({ success: true, redirectUrl: "/login" });
  } catch (err) {
    console.error("Registration error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during registration." });
  }
});

// ==========================================
// 6. SECURE STUDENT LOGIN & PORTAL
// ==========================================
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
        // Send a JSON success signal and the correct student portal URL
        res.status(200).json({ success: true, redirectUrl: "/student-portal" });
      });
    });
  } catch (err) {
    console.error("Database error during student login:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Protected Student Portal
app.get("/student-portal", requireRole("student"), (req, res) => {
  // Using the session loginId to show mock data so your EJS doesn't break
  const currentLoginId = req.session.user.loginId || "Unknown";

  let studentData = {
    name: currentLoginId,
    rollNo: currentLoginId,
    branch: "Chemical Engineering",
    gradYear: "2029",
  };

  if (currentLoginId.toLowerCase().includes("rahul")) {
    studentData = {
      name: "Rahul Kumar",
      rollNo: "2021CS0456",
      branch: "Chemical Engineering",
      gradYear: "2027",
    };
  }

  res.render("student-portal", { student: studentData });
});

// ==========================================
// 7. SECURE LOGOUT ROUTE
// ==========================================
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ==========================================
// 8. START SERVER
// ==========================================
app.listen(port, () => {
  console.log(`EduVerse Secure Server is awake and listening on port ${port}`);
});
