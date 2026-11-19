const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const { requireRole } = require('../middleware/rbac');

// Faculty create requests for their own classes; admins see all and decide.
router.get('/', requestController.listRequests);
router.post('/', requestController.createRequest);
router.put('/:id/decide', requireRole('admin'), requestController.decideRequest);
router.post('/:id/cancel', requestController.cancelRequest);

module.exports = router;
