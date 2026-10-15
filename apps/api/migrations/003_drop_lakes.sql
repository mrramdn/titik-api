-- COD-AB keeps lakes as pseudo-villages with a code ending in 888888 (here Danau Ranau). They are not villages.
DELETE FROM alerts WHERE village_id LIKE '%888888';
DELETE FROM subscriptions WHERE village_id LIKE '%888888';
DELETE FROM incidents WHERE village_id LIKE '%888888';
UPDATE detections SET village_id = NULL WHERE village_id LIKE '%888888';
DELETE FROM villages WHERE id LIKE '%888888';
DELETE FROM regencies WHERE name = 'Danau';
