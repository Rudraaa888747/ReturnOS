import path from 'node:path';
import { Router } from 'express';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { getDocument, listDocumentsByReturn } from '../store.js';

export const documentsRouter = Router();

documentsRouter.use(requireAuth, requireCustomer);

documentsRouter.get(
  '/return/:returnId',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const documents = listDocumentsByReturn(req.user.id, req.params.returnId);
    if (documents === null) {
      throw httpError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }
    res.json({ documents });
  }),
);

documentsRouter.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    // Ownership is checked before touching the filesystem, so foreign ids
    // safely map to 404 without leaking file existence.
    const document = getDocument(req.user.id, req.params.id);
    if (document === undefined) {
      throw httpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }
    const absolutePath = path.resolve(document.storage_path);
    res.sendFile(absolutePath, { headers: { 'Content-Type': document.mime } }, (err: Error | null) => {
      if (err !== null && err !== undefined && !res.headersSent) {
        res.status(404).json({ code: 'FILE_MISSING', message: 'Stored file is no longer available' });
      }
    });
  }),
);
