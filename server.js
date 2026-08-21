const express = require("express");
const crypto = require("crypto");
const app = express();

app.use(express.static("public"));

app.get("/", function (req, res) {
  res.send("SUCCESFULLY MADE OUR FIRST DEMO PAGE FOR SIH");
});

app.listen(3000, function () {
  console.log("Server is awake and listening on port 3000");
});
