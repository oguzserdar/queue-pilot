-- The "which app is this" choice is removed. Rows that held only that choice and no name the person gave carry nothing
-- once the column goes, and the name becomes required again.
DELETE FROM "qp_ai_app_label" WHERE "label" IS NULL;
