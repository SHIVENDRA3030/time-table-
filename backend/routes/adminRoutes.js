const express = require('express');
const router = express.Router();
const meController = require('../controllers/meController');
const adminController = require('../controllers/adminController');
const { requireRole } = require('../middleware/rbac');

// First-admin bootstrap: open to any authenticated caller while zero admins exist.
router.post('/bootstrap', meController.bootstrapAdmin);

// Everything below requires the admin role.
router.get('/users', requireRole('admin'), adminController.listUsers);
router.put('/users/:userId/role', requireRole('admin'), adminController.setUserRole);
router.get('/audit', requireRole('admin'), adminController.listAudit);
router.put('/sections/:id/publish', requireRole('admin'), adminController.publishSection);

module.exports = router;
