const { google } = require('googleapis');
const { Readable } = require('stream');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { texto, nombreArchivo } = req.body;
    if (!texto || !nombreArchivo) {
      return res.status(400).json({ error: 'Faltan campos' });
    }
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
    if (!folderId) {
      return res.status(500).json({ error: 'GOOGLE_FOLDER_ID no está configurado en Vercel' });
    }
    // Subir como Google Doc
    const gdoc = await drive.files.create({
      requestBody: {
        name: nombreArchivo + '.docx',
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: Readable.from([texto]),
      },
    });
    const gdocId = gdoc.data.id;
    // Exportar como PDF
    const pdfRes = await drive.files.export(
      { fileId: gdocId, mimeType: 'application/pdf' },
      { responseType: 'stream' }
    );
    const chunks = [];
    await new Promise((resolve, reject) => {
      pdfRes.data.on('data', c => chunks.push(c));
      pdfRes.data.on('end', resolve);
      pdfRes.data.on('error', reject);
    });
    // Subir PDF
    const pdfFile = await drive.files.create({
      requestBody: {
        name: nombreArchivo + '.pdf',
        mimeType: 'application/pdf',
        parents: [folderId],
      },
      media: {
        mimeType: 'application/pdf',
        body: Readable.from([Buffer.concat(chunks)]),
      },
    });
    // Borrar Doc temporal
    await drive.files.delete({ fileId: gdocId });
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
