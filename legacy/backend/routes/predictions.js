const express = require('express');
const predictionController = require('../controllers/predictionController');
const matchController = require('../controllers/matchController');

const router = express.Router();

router.get('/teams/search', predictionController.searchTeam);
router.get('/teams/:id', predictionController.teamInsight);
router.get('/leagues', matchController.leagues);

module.exports = router;
