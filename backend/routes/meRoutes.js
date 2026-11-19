const express = require('express');
const router = express.Router();
const meController = require('../controllers/meController');

// Both endpoints need only an authenticated caller; bootstrap self-guards.
router.get('/', meController.getMe);

module.exports = router;
