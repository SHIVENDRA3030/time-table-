// Job pipeline endpoints (enterprise plan F4): inspect jobs, commit staged
// imports, download finished exports. Mounted directly under /api and /api/v1;
// middleware is per-route so unmatched paths fall through.
const express = require('express');
const router = express.Router();
const jobService = require('../services/jobService');
const uploadController = require('../controllers/uploadController');
const exportController = require('../controllers/exportController');
const { requireProvisioned, requireRole } = require('../middleware/rbac');

// Same gate server.js defines inline for its mounts.
const requireAuth = (req, res, next) => {
    if (!req.auth || !req.auth.userId) return res.status(401).json({ error: 'Unauthorized' });
    next();
};

const canViewJob = (req, job) =>
    !job.created_by || job.created_by === req.auth?.userId || req.user?.role === 'admin' || req.user?.role === 'editor';

// GET /api/jobs/:id
router.get('/jobs/:id', requireAuth, requireProvisioned, async (req, res) => {
    try {
        const job = await jobService.getJob(req.params.id);
        if (!job || !canViewJob(req, job)) return res.status(404).json({ error: 'Job not found.' });
        res.json(job);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/imports/:id/commit — apply a staged import (editor/admin).
router.post('/imports/:id/commit', requireAuth, requireProvisioned, requireRole('admin', 'editor'), uploadController.commitImport);

// GET /api/exports/:id/download — stream a finished export workbook.
router.get('/exports/:id/download', requireAuth, exportController.downloadExport);

module.exports = router;
