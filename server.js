const express = require("express");
const crypto = require("crypto");
const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 1. Setup EJS and Public folder
app.set("view engine", "ejs");
app.use(express.static("public"));

// In-memory store for revocation demo
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

// 2. Render the Landing Page
app.get("/", (req, res) => {
  res.render("index");
});

// 3. The Cryptographic Blender (Test Route)
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

// Show the Administration Login Page
app.get("/administration_login", (req, res) => {
  // We check if the URL has ?error=true so we can show a wrong password warning
  const showError = req.query.error === "true";
  res.render("administration_login", { error: showError });
});

// Process the Login Attempt
app.post("/administration_login", (req, res) => {
  const enteredPassword = req.body.password;

  // Check if the password matches exactly
  if (enteredPassword === "nitr769008") {
    // Success! Send them to the dashboard
    res.redirect("/dashboard");
  } else {
    // Failed! Send them back to the login page with an error flag
    res.redirect("/administration_login?error=true");
  }
});

// 4. Dashboard & Admin Routes
app.get("/dashboard", (req, res) => {
  res.render("overview", { activePage: "overview" });
});

// Issue & Verify Page (GET)
app.get("/dashboard/issue", (req, res) => {
  res.render("issue", {
    activePage: "issue",
    credentialData: null,
  });
});

// Issue Page Form Submission (POST) - Updated to handle both /generate-hash and /dashboard/issue
app.post(["/generate-hash", "/dashboard/issue"], (req, res) => {
  const { studentName, rollNo, gradYear, degree, branch } = req.body;

  const rawData = `${studentName}|${rollNo}|${degree}|${branch}|${gradYear}`;
  const documentHash = crypto
    .createHash("sha256")
    .update(rawData)
    .digest("hex");
  const randomHex = crypto.randomBytes(2).toString("hex").toUpperCase();
  const certificateID = `CERT-${randomHex}`;

  res.render("issue", {
    activePage: "issue",
    credentialData: {
      id: certificateID,
      studentName: studentName,
      hash: documentHash,
    },
  });
});

// Verification Profile Page (GET)
app.get("/dashboard/verify", (req, res) => {
  res.render("verify", { activePage: "verify", verifiedData: null });
});

// Verification Action (POST)
app.post("/verify-action", (req, res) => {
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

// Revocation Registry Page (GET)
app.get("/dashboard/revoke", (req, res) => {
  res.render("revoke", {
    activePage: "revoke",
    revokedList: revokedList,
  });
});

// Revocation Action Form Submission (POST)
app.post("/revoke-action", (req, res) => {
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

// 5. Student Portal & Login Routes

// Render the Student Login Page (GET)
app.get("/login", (req, res) => {
  res.render("login", { activePage: "login" });
});

// Handle Student Login Submission (POST)
app.post("/login", (req, res) => {
  const { loginId, password } = req.body;

  if (!loginId || !password) {
    return res.redirect("/login");
  }

  let studentData = {
    name: loginId,
    rollNo: "125CH0053",
    branch: "Chemical Engineering",
    gradYear: "2029",
  };

  if (loginId.toLowerCase().includes("rahul")) {
    studentData = {
      name: "Rahul Kumar",
      rollNo: "2021CS0456",
      branch: "Chemical Engineering",
      gradYear: "2027",
    };
  }

  res.render("student-portal", { student: studentData });
});

// Fallback direct route for student portal
app.get("/student-portal", (req, res) => {
  const studentData = {
    name: "Utkarsh Tripathi",
    rollNo: "125CH0053",
    branch: "Chemical Engineering",
    gradYear: "2029",
  };

  res.render("student-portal", { student: studentData });
});

// 6. Start the Server
app.listen(port, () => {
  console.log(`Server is awake and listening on port ${port}`);
});
