const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { requireRole } = require('../middleware/rbac');

// Staged import: parse + validate only (202 + job id + preview). Committing
// happens via POST /api/imports/:id/commit (jobRoutes).
router.post('/', requireRole('admin', 'editor'), uploadController.uploadMiddleware, uploadController.stageUpload);
router.delete('/database', requireRole('admin'), uploadController.clearDatabaseData);

module.exports = router;
