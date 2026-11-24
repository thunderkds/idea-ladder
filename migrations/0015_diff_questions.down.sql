-- T014: reverts 0015_diff_questions. Drops only the two tables it added (their rows go with them).
DROP TABLE diff_questions;
DROP TABLE diff_question_sets;
