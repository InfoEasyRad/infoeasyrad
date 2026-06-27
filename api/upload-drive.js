const { google } = require('googleapis');

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { texto, nombreArchivo } = req.body;
    if (!texto || !nombreArchivo) {
      return res.status(400).json({ error: 'Faltan campos: texto y nombreArchivo' });
    }

    // Autenticar con Service Account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });
    const folderId = process.env.GOOGLE_FOLDER_ID;

    // 1. Subir texto como Google Doc (Drive convierte automáticamente)
    const { Readable } = require('stream');
    const stream = Readable.from([texto]);

    const gdoc = await drive.files.create({
      requestBody: {
        name: nombreArchivo + '.docx',
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: stream,
      },
    });

    const gdocId = gdoc.data.id;

    // 2. Exportar como PDF
    const pdfResponse = await drive.files.export(
      { fileId: gdocId, mimeType: 'application/pdf' },
      { responseType: 'stream' }
    );

    // 3. Subir PDF a la carpeta
    const chunks = [];
    await new Promise((resolve, reject) => {
      pdfResponse.data.on('data', chunk => chunks.push(chunk));
      pdfResponse.data.on('end', resolve);
      pdfResponse.data.on('error', reject);
    });
    const pdfBuffer = Buffer.concat(chunks);
    const pdfStream = Readable.from([pdfBuffer]);

    const pdfFile = await drive.files.create({
      requestBody: {
        name: nombreArchivo + '.pdf',
        mimeType: 'application/pdf',
        parents: [folderId],
      },
      media: {
        mimeType: 'application/pdf',
        body: pdfStream,
      },
    });

    // 4. Eliminar Google Doc temporal
    await drive.files.delete({ fileId: gdocId });

    // 5. Hacer el PDF públicamente visible (solo lectura)
    await drive.permissions.create({
      fileId: pdfFile.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    const pdfLink = `https://drive.google.com/file/d/${pdfFile.data.id}/view`;

    return res.status(200).json({
      success: true,
      link: pdfLink,
      nombre: nombreArchivo + '.pdf',
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
