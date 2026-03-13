'use strict';

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Returns a month folder string like "Mar2026". */
function getMonthFolder(date) {
  const d = date || new Date();
  return `${MONTH_NAMES[d.getMonth()]}${d.getFullYear()}`;
}

/** Returns the configured base URL (defaults to http://localhost:<port>). */
function getBaseUrl(core) {
  return process.env.BASE_URL || `http://localhost:${core.port}`;
}

/** Returns true when all required S3 env vars are set. */
function isS3Configured() {
  return !!(
    process.env.S3_BUCKET &&
    process.env.S3_ENDPOINT &&
    process.env.S3_REGION &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

/** Sanitizes a filename to prevent path traversal and special chars. */
function sanitizeFilename(filename) {
  return path.basename(filename)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '_');
}

/** Generates a short random unique prefix for filenames. */
function generateUniquePrefix() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

/** Saves a buffer to a local directory and returns the full file path. */
function saveLocally(buffer, dir, filename) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, filename);
  fs.writeFileSync(dest, buffer);
  return dest;
}

/**
 * Uploads a buffer to S3 and returns the public URL.
 * The path is optionally prefixed by S3_FOLDER_PREFIX.
 */
async function uploadToS3(buffer, key, contentType) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const folderPrefix = process.env.S3_FOLDER_PREFIX
    ? `${process.env.S3_FOLDER_PREFIX}/`
    : '';
  const fullKey = `${folderPrefix}${key}`;

  const client = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: fullKey,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${fullKey}`;
}

/**
 * Returns image processing options for the given entity + property.
 *
 * Defaults:
 *   - compress: true  (convert to JPEG at quality 80; disable with `options.compress: false`)
 *   - quality:  80    (JPEG quality 1-100; override with `options.quality`)
 *   - sizes:    null  (no resizing; enable with `options.sizes: { name: [w, h], ... }`)
 */
function getImageOptions(core, entity, property) {
  const entityDef = Object.values(core.entities || {}).find(
    (e) =>
      e.slug === entity ||
      e.tableName === entity ||
      e.name === entity
  );
  const propDef = entityDef && entityDef.properties.find((p) => p.name === property);
  const opts = (propDef && propDef.options) || {};

  return {
    compress: opts.compress !== false,
    quality:  typeof opts.quality === 'number' ? opts.quality : 80,
    sizes:    opts.sizes || null,
  };
}

/**
 * Register upload routes:
 *   POST /api/upload/file   — upload any file
 *   POST /api/upload/image  — upload + resize a PNG/JPG image
 */
function registerUploadRoutes(app, core) {
  const Busboy = getBusboy();

  // ── POST /api/upload/file ───────────────────────────────────────────────────
  app.post('/api/upload/file', (req, res) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Expected multipart/form-data' });
    }

    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let fileBuffer = null;
    let fileInfo = null;

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (_fieldname, stream, info) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
        fileInfo = info;
      });
    });

    bb.on('finish', async () => {
      try {
        if (!fileBuffer || !fileInfo || !fileInfo.filename) {
          return res.status(400).json({ error: 'No file provided' });
        }

        const { entity, property } = fields;
        if (!entity || !property) {
          return res.status(400).json({ error: 'Missing entity or property fields' });
        }

        const safeName = sanitizeFilename(fileInfo.filename);
        const prefix = generateUniquePrefix();
        const finalName = `${prefix}-${safeName}`;
        const monthFolder = getMonthFolder();
        const relPath = `storage/${entity}/${property}/${monthFolder}/${finalName}`;

        let url;
        if (isS3Configured()) {
          url = await uploadToS3(
            fileBuffer,
            relPath,
            fileInfo.mimeType || 'application/octet-stream'
          );
        } else {
          const publicFolder = (core.public && core.public.folder) || './public';
          const dir = path.resolve(
            publicFolder,
            'storage',
            entity,
            property,
            monthFolder
          );
          saveLocally(fileBuffer, dir, finalName);
          url = `${getBaseUrl(core)}/storage/${entity}/${property}/${monthFolder}/${finalName}`;
        }

        res.json({ path: url });
      } catch (err) {
        logger.error('File upload error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    bb.on('error', (err) => {
      logger.error('Upload parse error', err.message);
      res.status(500).json({ error: err.message });
    });

    req.pipe(bb);
  });

  // ── POST /api/upload/image ──────────────────────────────────────────────────
  app.post('/api/upload/image', (req, res) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Expected multipart/form-data' });
    }

    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let imageBuffer = null;
    let imageInfo = null;

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (_fieldname, stream, info) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        imageBuffer = Buffer.concat(chunks);
        imageInfo = info;
      });
    });

    bb.on('finish', async () => {
      try {
        if (!imageBuffer || !imageInfo || !imageInfo.filename) {
          return res.status(400).json({ error: 'No image provided' });
        }

        // Validate PNG/JPG only
        const mime = (imageInfo.mimeType || '').toLowerCase();
        const ext = path.extname(imageInfo.filename).toLowerCase();
        const validMime = mime === 'image/png' || mime === 'image/jpeg';
        const validExt = ext === '.png' || ext === '.jpg' || ext === '.jpeg';
        if (!validMime && !validExt) {
          return res
            .status(400)
            .json({ error: 'Only PNG and JPG images are accepted' });
        }

        const { entity, property } = fields;
        if (!entity || !property) {
          return res
            .status(400)
            .json({ error: 'Missing entity or property fields' });
        }

        const { compress, quality, sizes } = getImageOptions(core, entity, property);
        const prefix = generateUniquePrefix();
        const monthFolder = getMonthFolder();
        const sharp = getSharp();

        if (sizes) {
          // ── Resize mode: one output file per configured size ──────────────────
          const result = {};

          for (const [sizeName, dims] of Object.entries(sizes)) {
            const [width, height] = dims;
            const filename = `${prefix}-${sizeName}.jpg`;
            let pipeline = sharp(imageBuffer).resize(width, height, { fit: 'cover' });
            pipeline = compress
              ? pipeline.jpeg({ quality })
              : pipeline.jpeg({ quality: 100 });
            const processed = await pipeline.toBuffer();

            if (isS3Configured()) {
              const key = `storage/${entity}/${property}/${monthFolder}/${filename}`;
              result[sizeName] = await uploadToS3(processed, key, 'image/jpeg');
            } else {
              const publicFolder = (core.public && core.public.folder) || './public';
              const dir = path.resolve(
                publicFolder,
                'storage',
                entity,
                property,
                monthFolder
              );
              saveLocally(processed, dir, filename);
              result[sizeName] =
                `${getBaseUrl(core)}/storage/${entity}/${property}/${monthFolder}/${filename}`;
            }
          }

          return res.json(result);
        }

        // ── No-resize mode: single output file ───────────────────────────────
        let processedBuffer;
        let outputMime;
        let finalName;

        if (compress) {
          // Convert to JPEG with lossy compression
          processedBuffer = await sharp(imageBuffer).jpeg({ quality }).toBuffer();
          outputMime = 'image/jpeg';
          const baseName = path.basename(
            sanitizeFilename(imageInfo.filename),
            path.extname(imageInfo.filename)
          );
          finalName = `${prefix}-${baseName}.jpg`;
        } else {
          // Keep original bytes untouched
          processedBuffer = imageBuffer;
          outputMime = imageInfo.mimeType || 'image/octet-stream';
          finalName = `${prefix}-${sanitizeFilename(imageInfo.filename)}`;
        }

        let url;
        if (isS3Configured()) {
          const key = `storage/${entity}/${property}/${monthFolder}/${finalName}`;
          url = await uploadToS3(processedBuffer, key, outputMime);
        } else {
          const publicFolder = (core.public && core.public.folder) || './public';
          const dir = path.resolve(
            publicFolder,
            'storage',
            entity,
            property,
            monthFolder
          );
          saveLocally(processedBuffer, dir, finalName);
          url = `${getBaseUrl(core)}/storage/${entity}/${property}/${monthFolder}/${finalName}`;
        }

        res.json({ path: url });
      } catch (err) {
        logger.error('Image upload error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    bb.on('error', (err) => {
      logger.error('Upload parse error', err.message);
      res.status(500).json({ error: err.message });
    });

    req.pipe(bb);
  });

  logger.info(
    '  Registered upload routes at /api/upload/file and /api/upload/image'
  );
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

function getSharp() {
  try {
    return require('sharp');
  } catch {
    throw new Error(
      'sharp is required for image uploads. Install it with: npm install sharp'
    );
  }
}

module.exports = {
  registerUploadRoutes,
  getBaseUrl,
  getMonthFolder,
  isS3Configured,
  sanitizeFilename,
  generateUniquePrefix,
  saveLocally,
  getImageOptions,
};
