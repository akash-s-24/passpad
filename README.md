# PassPad

PassPad is a no-login shared workspace inspired by simple online pads. Everyone who enters the same shared password opens the same text area and the same uploaded files.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/akash-s-24/passpad)

## Features

- Shared page opened with a password, no account required
- Text notes with auto-save
- Drag-and-drop, multi-file, and pasted screenshot uploads
- Upload progress for each file
- File previews for images, PDFs, and text/data files
- Download all text and files as a ZIP
- Rename and delete uploaded files
- Search and sort uploaded files
- Optional edit password for read-only sharing
- Auto-expiring pads
- Pad storage meter and storage limit
- Delete entire pad
- Dark mode and responsive mobile layout
- Video uploads blocked
- Passwords are not stored directly; the server derives a room id from the password and `APP_SECRET`

## Run Locally

```bash
npm start
```

Open:

```txt
http://localhost:3000
```

## Environment Variables

```bash
PORT=3000
APP_SECRET=change-this-long-random-secret
DATA_DIR=/path/to/persistent/data
MAX_UPLOAD_BYTES=26214400
MAX_BATCH_UPLOAD_BYTES=104857600
MAX_UPLOAD_FILES=10
MAX_ROOM_BYTES=524288000
```

## Deployment Notes

This app stores text and uploads on disk. For real use, deploy it to a service that supports persistent disk storage, such as Render, Railway, Fly.io, or a VPS. The included `render.yaml` uses Render Free for an easy preview; upgrade to a paid service with a persistent disk when uploaded files must survive restarts.

Vercel serverless deployments are not recommended for this version because uploaded files and room data will not persist reliably between function invocations. To use Vercel properly, swap the storage layer for Supabase, S3, Cloudflare R2, or Vercel Blob.

## Render Example

1. Push this project to GitHub.
2. Create a new Render Web Service.
3. Build command: leave empty or use `npm install`.
4. Start command: `npm start`.
5. Add environment variable `APP_SECRET`.
6. Add a persistent disk mounted at `/opt/render/project/src/data`.
7. Add environment variable `DATA_DIR=/opt/render/project/src/data`.

## Docker

```bash
docker build -t passpad .
docker run -p 3000:3000 -e APP_SECRET=change-this-secret -v passpad-data:/app/data passpad
```
