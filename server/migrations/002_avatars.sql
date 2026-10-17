-- Profile pictures: the processed square image lives in the media dir; avatar_v is its cache-busting version (null = none).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_v text;
