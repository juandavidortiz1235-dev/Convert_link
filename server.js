const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

// Almacenamos los clientes conectados para enviarles el progreso
const progressClients = {};

app.get('/api/progress/:fileId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const { fileId } = req.params;
  progressClients[fileId] = res;

  // Enviar evento inicial de handshake
  res.write('data: connected\n\n');

  req.on('close', () => {
    delete progressClients[fileId];
  });
});

app.post('/api/convert', (req, res) => {
  const { url, format, fileId } = req.body; // FileID ahora viene del frontend
  
  if (!url || !fileId) {
    return res.status(400).json({ error: 'Faltan parámetros.' });
  }

  if (format !== 'mp3' && format !== 'mp4') {
    return res.status(400).json({ error: 'Formato no soportado.' });
  }

  let ytDlpArgs = [];
  const outputPath = path.join(tmpDir, `${fileId}_%(title)s.%(ext)s`);

  if (format === 'mp3') {
    ytDlpArgs = [
      '--ffmpeg-location', './ffmpeg',
      '--concurrent-fragments', '8',
      '-x', 
      '--audio-format', 'mp3',
      '-o', outputPath,
      '--no-playlist',
      url
    ];
  } else {
    // mp4
    ytDlpArgs = [
      '--ffmpeg-location', './ffmpeg',
      '--concurrent-fragments', '8',
      '-f', 'best[height<=720][ext=mp4]/best[ext=mp4]/b',
      '--merge-output-format', 'mp4',
      '-o', outputPath,
      '--no-playlist',
      url
    ];
  }

  console.log(`Starting download for: ${url} (Format: ${format}, FileID: ${fileId})`);
  
  const downloadProc = spawn('./yt-dlp', ytDlpArgs);
  
  downloadProc.stdout.on('data', (data) => {
      const text = data.toString();
      // console.log(`[yt-dlp]: ${text}`); // Ocultar para no saturar la terminal

      const match = text.match(/\[download\]\s+([\d\.]+)%/);
      if (match && progressClients[fileId]) {
         progressClients[fileId].write(`data: ${match[1]}\n\n`);
      } else if (text.includes('ExtractAudio') && progressClients[fileId]) {
         progressClients[fileId].write(`data: extracting\n\n`);
      }
  });

  let stderrLogs = '';
  downloadProc.stderr.on('data', (data) => {
      const text = data.toString();
      stderrLogs += text;
      console.error(`[yt-dlp error]: ${text}`);
  });

  downloadProc.on('close', (dlCode) => {
    if (progressClients[fileId]) {
        progressClients[fileId].write(`data: done\n\n`);
    }

    // Comprobamos si el archivo se generó, sin importar si yt-dlp tiró warnings (ej. cookies) que cambian el exit code
    const files = fs.readdirSync(tmpDir);
    const downloadedFile = files.find(file => file.startsWith(fileId));

    if (downloadedFile) {
        console.log(`Download complete: ${downloadedFile}`);
        return res.json({ success: true, downloadUrl: `/api/download/${encodeURIComponent(downloadedFile)}` });
    } else {
        console.error('Proceso falló. Logs de error de yt-dlp:\n', stderrLogs);
        return res.status(500).json({ error: 'Error durante la verificación de la URL o el proceso falló. Revisa los logs del servidor.' });
    }
  });
});

app.get('/api/download/:filename', (req, res) => {
   const filename = req.params.filename;
   const filePath = path.join(tmpDir, filename);
   
   if (fs.existsSync(filePath)) {
     // Eliminar la etiqueta interna 'media_TIMESTAMP_' para devolver solo el nombre original a la persona
     const firstUnderscore = filename.indexOf('_');
     const secondUnderscore = filename.indexOf('_', firstUnderscore + 1);
     const cleanName = secondUnderscore > -1 ? filename.substring(secondUnderscore + 1) : filename;

     // Content-Disposition 'attachment' fuerza a la mayoría de navegadores a descargar como archivo
     res.download(filePath, cleanName, (err) => {
        if (err) {
            console.error('Error enviando archivo:', err);
        }
        setTimeout(() => {
           if(fs.existsSync(filePath)) {
               fs.unlinkSync(filePath);
               console.log(`Deleted temp file: ${filePath}`);
           }
        }, 1000 * 60 * 5);
     });
   } else {
     res.status(404).send('Archivo no encontrado');
   }
});

app.listen(PORT, () => {
  console.log(`Server corriendo en http://localhost:${PORT}`);
});
