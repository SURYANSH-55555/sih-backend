const express = require('express');
const crypto = require('crypto');

const app = express();

// 1. Open the front door to the HTML/CSS
app.use(express.static('public'));

// 2. The Cryptographic Blender
function generateHash(studentData) {
  const dataString = JSON.stringify(studentData);
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

// 3. The Waiter's Pickup Window
app.get('/test-hash', function(req, res) {
  const student = {
    name: "Rahul Kumar",
    degree: "B.Tech",
    branch: "Chemical Engineering",
    year: "2027"
  };

  const fingerprint = generateHash(student);

  res.send({
    message: "Certificate Hashed Successfully!",
    data: student,
    sha256_hash: fingerprint
  });
});

app.listen(3000, function() {
  console.log('Server is awake and listening on port 3000');
});