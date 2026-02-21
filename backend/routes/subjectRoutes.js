const express = require('express');
const router = express.Router();
const controller = require('../controllers/subjectController');

router.get('/faculty', controller.getAllFaculty);
router.post('/faculty', controller.createFaculty);
router.get('/subjects', controller.getAllSubjects);
router.post('/subjects', controller.createSubject);
router.get('/rooms', controller.getAllRooms);
router.post('/rooms', controller.createRoom);

module.exports = router;
