const express = require('express');
const router = express.Router();
const controller = require('../controllers/workloadController');
const { requireRole } = require('../middleware/rbac');

router.get('/', controller.getAllWorkloads);
router.post('/', requireRole('admin', 'editor'), controller.createWorkload);
router.put('/:id', requireRole('admin', 'editor'), controller.updateWorkload);
router.delete('/:id', requireRole('admin', 'editor'), controller.deleteWorkload);

module.exports = router;
