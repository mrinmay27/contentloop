-- Move already-published topics to the state that says so.
--
-- QueueState has declared SCHEDULED and POSTED from the start, but nothing
-- ever wrote them: topics stopped at QA_PASSED. So every topic that has ever
-- been published still sits in Selected/Review, offering Edit and Approve as
-- though it were unfinished, while the dashboard's Posted tab reads that same
-- state and shows zero.
--
-- Code now advances the state on publish and on schedule. This corrects the
-- history that accumulated before it did.
--
-- Dry runs are excluded on purpose — nothing was sent, so nothing was posted.
UPDATE topics t
SET state = 'POSTED'
FROM content_items c
JOIN publish_jobs pj ON pj.content_item_id = c.id
WHERE t.id = c.topic_id
  AND pj.status = 'published'
  AND pj.dry_run IS NOT TRUE
  AND t.state <> 'POSTED';

-- Scheduled but not yet sent.
UPDATE topics t
SET state = 'SCHEDULED'
FROM content_items c
JOIN publish_jobs pj ON pj.content_item_id = c.id
WHERE t.id = c.topic_id
  AND pj.status = 'scheduled'
  AND t.state NOT IN ('POSTED', 'SCHEDULED');
