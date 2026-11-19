const express = require('express');
const router = express.Router();
const timetableController = require('../controllers/timetableController');
const { requireRole } = require('../middleware/rbac');

// Reads stay open to every authenticated user; viewer-level published filtering
// happens inside the controller.
router.get('/', timetableController.getAllTimetables);
router.get('/time-slots', timetableController.getTimeSlots);
router.get('/section/:id', timetableController.getTimetableBySection);
router.get('/faculty/:id', timetableController.getTimetableByFaculty);
router.get('/room/:id', timetableController.getTimetableByRoom);

// Mutations are editor+ only.
router.post('/generate', requireRole('admin', 'editor'), timetableController.generateSchedule);
router.post('/', requireRole('admin', 'editor'), timetableController.createEntry);
router.put('/:id', requireRole('admin', 'editor'), timetableController.updateEntry);
router.delete('/:id', requireRole('admin', 'editor'), timetableController.deleteEntry);
router.delete('/section/:id', requireRole('admin', 'editor'), timetableController.clearSectionTimetable);

// Time-slot management: editors can add/edit, deleting a period cascades its
// entries, so that stays admin-only.
router.post('/time-slots', requireRole('admin', 'editor'), timetableController.createTimeSlot);
router.put('/time-slots/:id', requireRole('admin', 'editor'), timetableController.updateTimeSlot);
router.delete('/time-slots/:id', requireRole('admin'), timetableController.deleteTimeSlot);

module.exports = router;
