const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { requireRole } = require('../middleware/rbac');

// Legacy synchronous download (existing web UI). New clients: POST here, then
// GET /api/exports/:id/download when the job completes.
router.get('/timetable/:sectionId.xlsx', requireRole('admin', 'editor'), exportController.exportSectionTimetable);
router.post('/timetable/:sectionId', requireRole('admin', 'editor'), exportController.queueSectionExport);

module.exports = router;
