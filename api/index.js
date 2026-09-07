// /api/index.js - Servir index.html en la raíz
const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  
  try {
    // Leer index.html desde public/
    const indexPath = path.join(process.cwd(), 'public/index.html');
    
    // Si no existe en public/, intentar desde raíz
    if (!fs.existsSync(indexPath)) {
      const rootIndexPath = path.join(process.cwd(), 'index.html');
      if (fs.existsSync(rootIndexPath)) {
        const content = fs.readFileSync(rootIndexPath, 'utf8');
        return res.status(200).send(content);
      }
    } else {
      const content = fs.readFileSync(indexPath, 'utf8');
      return res.status(200).send(content);
    }
    
    res.status(404).send('index.html no encontrado');
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error interno');
  }
};
