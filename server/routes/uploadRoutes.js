const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/', uploadController.uploadMiddleware, uploadController.uploadExcel);
router.delete('/database', uploadController.clearDatabaseData);

module.exports = router;
