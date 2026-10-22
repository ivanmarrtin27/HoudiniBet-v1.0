const express = require('express');
const matchController = require('../controllers/matchController');
const syncAuth = require('../middleware/syncAuth');

const router = express.Router();

router.post('/manual', syncAuth, matchController.manualSync);

module.exports = router;
