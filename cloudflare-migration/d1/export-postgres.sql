-- Run against the selected source in a read-only transaction. Save stdout to a
-- private file; never put the exported rows in logs or source control.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'boss_types',(SELECT coalesce(json_agg(t),'[]'::json) FROM boss_types t),
 'boss_kills',(SELECT coalesce(json_agg(t),'[]'::json) FROM boss_kills t),
 'chat_settings',(SELECT coalesce(json_agg(t),'[]'::json) FROM chat_settings t),
 'staging_admin_challenges',(SELECT coalesce(json_agg(t),'[]'::json) FROM staging_admin_challenges t),
 'staging_line_events',(SELECT coalesce(json_agg(t),'[]'::json) FROM staging_line_events t)
);
COMMIT;
