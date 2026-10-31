const path = require('node:path');
const fs = require('node:fs');
const requestHandler = require('../server');

// Force Vercel NFT (Node File Trace) to bundle static HTML files into the lambda function
if (process.env.VERCEL_INCLUDE_FILES) {
  try {
    fs.readFileSync(path.join(__dirname, '..', 'manage.html'));
    fs.readFileSync(path.join(__dirname, '..', 'admin.html'));
    fs.readFileSync(path.join(__dirname, '..', 'index.html'));
    fs.readFileSync(path.join(__dirname, '..', 'ticket.html'));
  } catch (_) {}
}

module.exports = async (req, res) => {
  return requestHandler(req, res);
};
