const express = require('express');
const router = express.Router();
const controller = require('../controllers/programSectionController');
const { requireRole } = require('../middleware/rbac');

router.get('/programs', controller.getAllPrograms);
router.post('/programs', requireRole('admin', 'editor'), controller.createProgram);
router.put('/programs/:id', requireRole('admin', 'editor'), controller.updateProgram);
router.delete('/programs/:id', requireRole('admin', 'editor'), controller.deleteProgram);

router.get('/sections', controller.getAllSections);
router.post('/sections', requireRole('admin', 'editor'), controller.createSection);
router.post('/sections/bulk', requireRole('admin', 'editor'), controller.bulkCreateSections);
router.put('/sections/:id', requireRole('admin', 'editor'), controller.updateSection);
router.delete('/sections/:id', requireRole('admin', 'editor'), controller.deleteSection);

module.exports = router;
