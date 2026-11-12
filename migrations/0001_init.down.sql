-- DESTRUCTIVE: drops all users and sessions. Never run in production without the T018 runbook.
DROP TABLE sessions;
DROP TABLE users;
DROP EXTENSION vector;
