import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import { config } from '../config.js';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { HttpError, asyncHandler, httpError } from '../middleware/error.js';
import { addReturnEvent, createDocument, createNotification, getReturnDetail } from '../store.js';

export const uploadsRouter = Router();

uploadsRouter.use(requireAuth, requireCustomer);

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/** Multer-compatible rejection error handled by the central error handler. */
class InvalidFileTypeError extends HttpError {
  constructor() {
    super(400, 'INVALID_FILE_TYPE', 'Only JPG, PNG, WEBP, and PDF files are accepted');
    this.name = 'InvalidFileTypeError';
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb: (error: Error | null, destination: string) => void): void => {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    cb(null, config.uploadDir);
  },
  filename: (_req, file, cb: (error: Error | null, filename: string) => void): void => {
    const extension = ALLOWED_MIME[file.mimetype] ?? path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

function fileFilter(_req: Express.Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (ALLOWED_MIME[file.mimetype] === undefined) {
    cb(new InvalidFileTypeError());
    return;
  }
  cb(null, true);
}

/** Sanitize a user-supplied document kind label. */
function sanitizeKind(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim().length > 0 && raw.length <= 40) {
    return raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  }
  return 'EVIDENCE';
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

uploadsRouter.post(
  '/return/:returnId',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    // Ownership is verified before accepting the file metadata so foreign
    // return ids safely map to 404.
    const detail = getReturnDetail(req.user.id, req.params.returnId);
    if (detail === null) {
      if (req.file !== undefined) {
        await fs.promises.unlink(req.file.path).catch(() => undefined);
      }
      throw httpError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }
    if (req.file === undefined) {
      throw httpError(400, 'FILE_REQUIRED', 'A file upload named "file" is required');
    }
    const kind = sanitizeKind(req.body.kind);
    const document = createDocument({
      returnId: detail.ret.id,
      userId: req.user.id,
      kind,
      filename: req.file.originalname,
      mime: req.file.mimetype,
      size: req.file.size,
      storagePath: req.file.path,
    });
    addReturnEvent(detail.ret.id, detail.ret.status, `Document uploaded: ${req.file.originalname}`);
    createNotification(req.user.id, {
      returnId: detail.ret.id,
      type: 'DOCUMENT_UPLOADED',
      title: 'Document uploaded',
      body: `${req.file.originalname} was attached to return ${detail.ret.return_number}.`,
    });
    res.status(201).json({ document });
  }),
);
