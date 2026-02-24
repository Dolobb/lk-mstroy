-- Drop unique constraint on requests.number
-- TIS API can return multiple requests with the same number but different request_id
-- (e.g. when a request is recreated/duplicated)
-- The index for query performance is kept (idx_requests_number)
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_number_key;
