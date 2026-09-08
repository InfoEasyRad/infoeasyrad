const { google } = require('googleapis');
const { Readable } = require('stream');
const PDFDocument = require('pdfkit');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { texto, nombreArchivo } = req.body;
    if (!texto || !nombreArchivo) return res.status(400).json({ error: 'Faltan campos' });

    // Generar PDF con pdfkit (sin pasar por Google Docs)
    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(11).font('Helvetica');
      const lineas = texto.split('\n');
      lineas.forEach(linea => {
        if (linea.trim() === '') {
          doc.moveDown(0.5);
        } else {
          doc.text(linea, { align: 'justify' });
        }
      });
      doc.end();
    });

    // Autenticar Service Account
    let privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const folderId = process.env.GOOGLE_FOLDER_ID;

    // Subir PDF directo a Drive
    const pdfFile = await drive.files.create({
      requestBody: {
        name: nombreArchivo + '.pdf',
        mimeType: 'application/pdf',
        parents: [folderId],
      },
      media: {
        mimeType: 'application/pdf',
        body: Readable.from([pdfBuffer]),
      },
    });

    // Hacer público
    await drive.permissions.create({
      fileId: pdfFile.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    return res.status(200).json({
      success: true,
      link: `https://drive.google.com/file/d/${pdfFile.data.id}/view`,
      nombre: nombreArchivo + '.pdf',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
