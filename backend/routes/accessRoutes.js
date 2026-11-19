const express = require('express');
const router = express.Router();
const accessController = require('../controllers/accessController');
const { requireRole } = require('../middleware/rbac');

// The gate check runs on the public login page, before any session exists.
// Everything else is admin-only (requireRole also 401s anonymous callers).
router.post('/check', accessController.check);
router.get('/', requireRole('admin'), accessController.list);
router.post('/', requireRole('admin'), accessController.add);
router.post('/bulk', requireRole('admin'), accessController.uploadMiddleware, accessController.bulk);
router.put('/:id', requireRole('admin'), accessController.update);
router.delete('/:id', requireRole('admin'), accessController.remove);

module.exports = router;
