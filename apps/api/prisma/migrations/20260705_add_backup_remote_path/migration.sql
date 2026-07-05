-- Cloud backup destinations (S3-compatible / SFTP / Google Drive). `disk`
-- already existed (default "local") but was never read; remotePath pins the
-- resolved bucket-key/sftp-path/gdrive-fileId at upload time.
ALTER TABLE "Backup" ADD COLUMN IF NOT EXISTS "remotePath" TEXT;
