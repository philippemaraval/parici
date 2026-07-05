UPDATE users
SET role = 'admin'
WHERE LOWER(TRIM(username)) = 'mphil';
