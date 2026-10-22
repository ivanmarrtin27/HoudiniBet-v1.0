const express = require('express');
const matchController = require('../controllers/matchController');

const router = express.Router();

router.get('/today', matchController.today);
router.get('/best-bets', matchController.bestBets);
router.get('/:id/prediction', matchController.prediction);

module.exports = router;
