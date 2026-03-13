'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const logger = require('../utils/logger');

/**
 * Register file storage routes for all buckets defined in core.files.
 * Each bucket exposes:
 *   POST   /files/<bucket>          — upload (multipart/form-data, field name "file")
 *   GET    /files/<bucket>/:file    — download
 */
function registerFileRoutes(app, core) {
  const cwd = process.cwd();

  for (const [bucketName, bucketDef] of Object.entries(core.files)) {
    const bucketPath = path.resolve(bucketDef.path);

    // Validate that the bucket path stays within the working directory
    if (!bucketPath.startsWith(cwd + path.sep) && bucketPath !== cwd) {
      throw new Error(
        `File bucket "${bucketName}" path "${bucketDef.path}" resolves outside the working directory.`
      );
    }

    // Ensure the upload directory exists
    fs.mkdirSync(bucketPath, { recursive: true });

    // Serve files statically if public
    if (bucketDef.public !== false) {
      app.use(`/files/${bucketName}`, express.static(bucketPath));
    }

    // Upload endpoint — uses raw multipart parsing via busboy
    app.post(`/files/${bucketName}`, (req, res) => {
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return res.status(400).json({ error: 'Expected multipart/form-data' });
      }

      const Busboy = getBusboy();
      const busboy = Busboy({ headers: req.headers });
      let saved = false;
      let savedName = null;

      busboy.on('file', (fieldname, file, info) => {
        const { filename } = info;
        if (!filename) {
          file.resume();
          return;
        }
        // Sanitize filename — strip directory traversal and disallow problematic characters
        const safeName = path
          .basename(filename)
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .replace(/^\.+/, '_');
        const dest = path.join(bucketPath, safeName);
        const writeStream = fs.createWriteStream(dest);
        file.pipe(writeStream);
        writeStream.on('finish', () => {
          saved = true;
          savedName = safeName;
        });
      });

      busboy.on('finish', () => {
        if (saved) {
          res.json({ file: savedName, url: `/files/${bucketName}/${savedName}` });
        } else {
          res.status(400).json({ error: 'No file field found in upload' });
        }
      });

      busboy.on('error', (err) => {
        logger.error('Upload error', err.message);
        res.status(500).json({ error: err.message });
      });

      req.pipe(busboy);
    });

    logger.info(`  Registered file bucket "${bucketName}" at /files/${bucketName} -> ${bucketPath}`);
  }
}

function getBusboy() {
  try {
    return require('busboy');
  } catch {
    throw new Error(
      'busboy is required for file uploads. Install it with: npm install busboy'
    );
  }
}

module.exports = { registerFileRoutes };
