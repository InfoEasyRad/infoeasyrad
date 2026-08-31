const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const filePath = path.join(__dirname, '../index.html');
    const content = fs.readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.status(200).send(content);
  } catch (err) {
    console.error('Error serving index.html:', err);
    res.status(500).json({ error: 'Failed to serve index.html', msg: err.message });
  }
};
