const express = require('express');
const app = express();

app.get('/', function(req, res) {
  res.send('SUCCESFULLY MADE OUR FIRST DEMO PAGE FOR SIH');
});

app.listen(3000, function() {
  console.log('Server is awake and listening on port 3000');
});