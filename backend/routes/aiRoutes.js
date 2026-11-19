const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

router.get('/models', aiController.listModels);
router.post('/insights', aiController.getInsights);

module.exports = router;
