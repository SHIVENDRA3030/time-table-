const express = require('express');
const router = express.Router();
const timetableController = require('../controllers/timetableController');

router.get('/', timetableController.getAllTimetables);
router.get('/section/:id', timetableController.getTimetableBySection);
router.get('/faculty/:id', timetableController.getTimetableByFaculty);
router.get('/room/:id', timetableController.getTimetableByRoom);
router.post('/', timetableController.createEntry);

module.exports = router;
