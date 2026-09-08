// /api/transcribe.js — Transcribe audio usando OpenAI Whisper (key server-side)
const { IncomingForm } = require('formidable');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function verificarToken(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const authUser = await verificarToken(req);
  if (!authUser) return res.status(401).json({ error: 'no_autorizado', mensaje: 'Sesión inválida o expirada' });

  try {
    // Parsear el FormData con formidable
    const form = new IncomingForm({ keepExtensions: true });
    
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const audioFile = files.file?.[0] || files.file;
    if (!audioFile) throw new Error('No se recibió archivo de audio');

    const filepath = audioFile.filepath || audioFile.path;
    const originalName = audioFile.originalFilename || audioFile.name || 'audio.webm';
    const mimeType = audioFile.mimetype || audioFile.type || 'audio/webm';

    // Leer el archivo
    const audioBuffer = fs.readFileSync(filepath);

    // Construir multipart manualmente para OpenAI
    const boundary = '----FormBoundary' + Date.now().toString(36);
    const ext = path.extname(originalName) || '.webm';
    const filename = `audio${ext}`;

    const part1 = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    );
    const part2 = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\nes\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n` +
      `--${boundary}--\r\n`
    );

    const multipartBody = Buffer.concat([part1, audioBuffer, part2]);

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      throw new Error('Error Whisper: ' + err);
    }

    const texto = await whisperRes.text();
    return res.status(200).json({ texto });

  } catch (e) {
    console.error('Error transcribe:', e);
    return res.status(500).json({ error: e.message });
  }
};
