const express = require('express');
const router = express.Router();
const controller = require('../controllers/subjectController');
const { requireRole } = require('../middleware/rbac');

router.get('/faculty', controller.getAllFaculty);
router.post('/faculty', requireRole('admin', 'editor'), controller.createFaculty);
router.put('/faculty/:id', requireRole('admin', 'editor'), controller.updateFaculty);
router.put('/faculty/:id/subjects', requireRole('admin', 'editor'), controller.updateFacultySubjects);
router.delete('/faculty/:id', requireRole('admin', 'editor'), controller.deleteFaculty);

router.get('/subjects', controller.getAllSubjects);
router.post('/subjects', requireRole('admin', 'editor'), controller.createSubject);
router.put('/subjects/:id', requireRole('admin', 'editor'), controller.updateSubject);
router.delete('/subjects/:id', requireRole('admin', 'editor'), controller.deleteSubject);

router.get('/rooms', controller.getAllRooms);
router.post('/rooms', requireRole('admin', 'editor'), controller.createRoom);
router.put('/rooms/:id', requireRole('admin', 'editor'), controller.updateRoom);
router.delete('/rooms/:id', requireRole('admin', 'editor'), controller.deleteRoom);

module.exports = router;
