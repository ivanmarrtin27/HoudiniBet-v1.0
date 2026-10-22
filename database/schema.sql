-- Houdini Bet — schema MySQL
CREATE DATABASE IF NOT EXISTS houdini_bet
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE houdini_bet;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS odds;
DROP TABLE IF EXISTS predictions;
DROP TABLE IF EXISTS team_stats;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS leagues;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE leagues (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  country VARCHAR(80) NOT NULL,
  logo_url VARCHAR(512) NULL,
  api_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leagues_api_id (api_id)
) ENGINE=InnoDB;

CREATE TABLE teams (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  logo_url VARCHAR(512) NULL,
  league_id INT UNSIGNED NOT NULL,
  api_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_teams_api_id (api_id),
  KEY idx_teams_league (league_id),
  KEY idx_teams_name (name),
  CONSTRAINT fk_teams_league FOREIGN KEY (league_id) REFERENCES leagues (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE matches (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  league_id INT UNSIGNED NOT NULL,
  home_team_id INT UNSIGNED NOT NULL,
  away_team_id INT UNSIGNED NOT NULL,
  match_date DATETIME NOT NULL,
  status ENUM('scheduled', 'live', 'finished') NOT NULL DEFAULT 'scheduled',
  home_goals INT UNSIGNED NULL,
  away_goals INT UNSIGNED NULL,
  api_id INT UNSIGNED NOT NULL,
  af_fixture_id INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_matches_api_id (api_id),
  KEY idx_matches_date (match_date),
  KEY idx_matches_league (league_id),
  KEY idx_matches_status (status),
  KEY idx_matches_af_fixture (af_fixture_id),
  CONSTRAINT fk_matches_league FOREIGN KEY (league_id) REFERENCES leagues (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_matches_home FOREIGN KEY (home_team_id) REFERENCES teams (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_matches_away FOREIGN KEY (away_team_id) REFERENCES teams (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE team_stats (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id INT UNSIGNED NOT NULL,
  match_id INT UNSIGNED NOT NULL,
  goals_scored INT UNSIGNED NOT NULL DEFAULT 0,
  goals_conceded INT UNSIGNED NOT NULL DEFAULT 0,
  corners_for INT UNSIGNED NULL,
  corners_against INT UNSIGNED NULL,
  shots_on_target_for INT UNSIGNED NULL,
  shots_on_target_against INT UNSIGNED NULL,
  is_home TINYINT(1) NOT NULL DEFAULT 0,
  match_date DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_stats_match_team (match_id, team_id),
  KEY idx_team_stats_team (team_id),
  KEY idx_team_stats_date (match_date),
  CONSTRAINT fk_stats_team FOREIGN KEY (team_id) REFERENCES teams (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_stats_match FOREIGN KEY (match_id) REFERENCES matches (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE predictions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_id INT UNSIGNED NOT NULL,
  home_win_prob DECIMAL(6,4) NOT NULL,
  draw_prob DECIMAL(6,4) NOT NULL,
  away_win_prob DECIMAL(6,4) NOT NULL,
  over25_prob DECIMAL(6,4) NOT NULL,
  under25_prob DECIMAL(6,4) NOT NULL,
  btts_yes_prob DECIMAL(6,4) NULL,
  btts_no_prob DECIMAL(6,4) NULL,
  corners_over95_prob DECIMAL(6,4) NULL,
  corners_under95_prob DECIMAL(6,4) NULL,
  shots_over225_prob DECIMAL(6,4) NULL,
  shots_under225_prob DECIMAL(6,4) NULL,
  shots_over255_prob DECIMAL(6,4) NULL,
  shots_under255_prob DECIMAL(6,4) NULL,
  sot_over75_prob DECIMAL(6,4) NULL,
  sot_under75_prob DECIMAL(6,4) NULL,
  sot_over85_prob DECIMAL(6,4) NULL,
  sot_under85_prob DECIMAL(6,4) NULL,
  sot_over95_prob DECIMAL(6,4) NULL,
  sot_under95_prob DECIMAL(6,4) NULL,
  suggested_bet VARCHAR(64) NOT NULL,
  secondary_bet VARCHAR(64) NULL,
  confidence_score DECIMAL(5,2) NOT NULL,
  value_edge DECIMAL(6,4) NULL,
  value_market VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_predictions_match (match_id),
  KEY idx_predictions_confidence (confidence_score),
  CONSTRAINT fk_predictions_match FOREIGN KEY (match_id) REFERENCES matches (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE odds (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_id INT UNSIGNED NOT NULL,
  bookmaker VARCHAR(80) NOT NULL DEFAULT 'avg',
  home_odds DECIMAL(8,3) NULL,
  draw_odds DECIMAL(8,3) NULL,
  away_odds DECIMAL(8,3) NULL,
  over15_odds DECIMAL(8,3) NULL,
  under15_odds DECIMAL(8,3) NULL,
  over25_odds DECIMAL(8,3) NULL,
  under25_odds DECIMAL(8,3) NULL,
  over35_odds DECIMAL(8,3) NULL,
  under35_odds DECIMAL(8,3) NULL,
  btts_yes_odds DECIMAL(8,3) NULL,
  btts_no_odds DECIMAL(8,3) NULL,
  shots_over225_odds DECIMAL(8,3) NULL,
  shots_under225_odds DECIMAL(8,3) NULL,
  shots_over255_odds DECIMAL(8,3) NULL,
  shots_under255_odds DECIMAL(8,3) NULL,
  sot_over75_odds DECIMAL(8,3) NULL,
  sot_under75_odds DECIMAL(8,3) NULL,
  sot_over85_odds DECIMAL(8,3) NULL,
  sot_under85_odds DECIMAL(8,3) NULL,
  sot_over95_odds DECIMAL(8,3) NULL,
  sot_under95_odds DECIMAL(8,3) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_odds_match_book (match_id, bookmaker),
  CONSTRAINT fk_odds_match FOREIGN KEY (match_id) REFERENCES matches (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seed ligas (api_ids API-Football)
INSERT INTO leagues (name, country, logo_url, api_id) VALUES
  ('La Liga', 'Spain', NULL, 140),
  ('Segunda División', 'Spain', NULL, 141),
  ('Premier League', 'England', NULL, 39),
  ('Serie A', 'Italy', NULL, 135),
  ('Bundesliga', 'Germany', NULL, 78),
  ('Ligue 1', 'France', NULL, 61);

-- Equipos demo (api_id inventados altos para no chocar con sync real)
INSERT INTO teams (name, logo_url, league_id, api_id) VALUES
  ('Real Madrid', NULL, 1, 900001),
  ('FC Barcelona', NULL, 1, 900002),
  ('Sevilla FC', NULL, 1, 900003),
  ('Real Betis', NULL, 1, 900004),
  ('Levante UD', NULL, 2, 900011),
  ('Real Zaragoza', NULL, 2, 900012),
  ('Arsenal', NULL, 3, 900021),
  ('Chelsea', NULL, 3, 900022);

-- Partidos demo: 5 finished por par de equipos + 2 scheduled hoy
INSERT INTO matches (league_id, home_team_id, away_team_id, match_date, status, home_goals, away_goals, api_id) VALUES
  (1, 1, 3, DATE_SUB(CURDATE(), INTERVAL 20 DAY), 'finished', 2, 0, 910001),
  (1, 4, 1, DATE_SUB(CURDATE(), INTERVAL 16 DAY), 'finished', 1, 1, 910002),
  (1, 1, 4, DATE_SUB(CURDATE(), INTERVAL 12 DAY), 'finished', 3, 1, 910003),
  (1, 2, 1, DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'finished', 1, 2, 910004),
  (1, 1, 2, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'finished', 2, 1, 910005),
  (1, 2, 4, DATE_SUB(CURDATE(), INTERVAL 18 DAY), 'finished', 2, 2, 910006),
  (1, 3, 2, DATE_SUB(CURDATE(), INTERVAL 14 DAY), 'finished', 0, 2, 910007),
  (1, 2, 3, DATE_SUB(CURDATE(), INTERVAL 10 DAY), 'finished', 3, 0, 910008),
  (1, 4, 2, DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'finished', 1, 3, 910009),
  (1, 3, 4, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'finished', 1, 0, 910010),
  (1, 3, 1, DATE_SUB(CURDATE(), INTERVAL 19 DAY), 'finished', 0, 1, 910011),
  (1, 4, 3, DATE_SUB(CURDATE(), INTERVAL 11 DAY), 'finished', 2, 1, 910012),
  (1, 3, 2, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'finished', 1, 1, 910013),
  (3, 7, 8, DATE_SUB(CURDATE(), INTERVAL 9 DAY), 'finished', 2, 1, 910021),
  (3, 8, 7, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'finished', 0, 2, 910022),
  (1, 1, 2, CONCAT(CURDATE(), ' 18:00:00'), 'scheduled', NULL, NULL, 910101),
  (1, 3, 4, CONCAT(CURDATE(), ' 21:00:00'), 'scheduled', NULL, NULL, 910102),
  (3, 7, 8, CONCAT(CURDATE(), ' 16:30:00'), 'scheduled', NULL, NULL, 910103);

-- team_stats desde finished (home + away)
INSERT INTO team_stats (team_id, match_id, goals_scored, goals_conceded, corners_for, corners_against, is_home, match_date)
SELECT home_team_id, id, home_goals, away_goals, 5 + (id % 4), 4 + (id % 3), 1, match_date
FROM matches WHERE status = 'finished';

INSERT INTO team_stats (team_id, match_id, goals_scored, goals_conceded, corners_for, corners_against, is_home, match_date)
SELECT away_team_id, id, away_goals, home_goals, 4 + (id % 3), 5 + (id % 4), 0, match_date
FROM matches WHERE status = 'finished';

INSERT INTO odds (match_id, bookmaker, home_odds, draw_odds, away_odds, over25_odds, under25_odds)
SELECT id, 'avg', 2.10, 3.40, 3.20, 1.85, 1.95
FROM matches WHERE status = 'scheduled';
