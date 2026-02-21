const express = require('express');
const router = express.Router();
const controller = require('../controllers/programSectionController');

router.get('/programs', controller.getAllPrograms);
router.post('/programs', controller.createProgram);
router.get('/sections', controller.getAllSections);
router.post('/sections', controller.createSection);

module.exports = router;
