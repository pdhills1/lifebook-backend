# "My Story" — Backend API Specification

All endpoints are prefixed `/api`. Authentication is via a Supabase-issued
JWT, sent as `Authorization: Bearer <token>` on every request (the frontend
gets this token automatically from the Supabase client after login).

The backend verifies the token on every request to identify the calling
user, then checks `profiles.role` for admin-only endpoints. The database's
own Row Level Security is a second, independent layer of protection
underneath this.

---

## Auth & bootstrap

### POST /api/bootstrap
Called once, right after a user's first successful login. Idempotent — safe
to call every login; does nothing if the book already exists.

- Creates a `profiles` row if missing (role defaults to `author`).
- Creates a `books` row if missing.
- Creates one `entries` row per non-repeatable chapter (1-7, 9-12) if missing.
- Does NOT create any Chapter 8 entries — those are added explicitly by the
  user, since Chapter 8 has no "default person."

**Response 200:**
```json
{ "bookId": "uuid", "bookTitle": "My Story", "status": "in_progress" }
```

---

## Book & chapter navigation

### GET /api/book
Returns the current user's whole book: chapter list with progress, and all
Chapter 8 people entries (names only, for the chapter-8 picker screen).

**Response 200:**
```json
{
  "bookId": "uuid",
  "title": "My Story",
  "status": "in_progress",
  "chapters": [
    { "chapterId": "ch01", "coreAnswered": 1, "coreTotal": 2, "complete": false },
    ...
  ],
  "people": [
    { "entryId": "uuid", "name": "Sophie", "relationship": "Daughter" }
  ]
}
```

### GET /api/chapter/:chapterId?entryId=<uuid>
Returns all saved answers for one chapter (and, for Chapter 8, one specific
person's entry — `entryId` is required for ch08, ignored otherwise).

**Response 200:**
```json
{
  "chapterId": "ch03",
  "entryId": "uuid",
  "answers": {
    "ch03_q1": { "text": "I remember the seaside..." },
    "ch03_q8": { "photoUrl": "https://.../signed-url", "caption": "Me aged 6" }
  },
  "bonusPhotos": [
    { "id": "uuid", "photoUrl": "https://.../signed-url", "caption": "Family BBQ" }
  ]
}
```
Only answered questions appear in `answers`; the frontend renders blanks for
the rest by cross-referencing book-schema.json.

---

## Saving answers

### PUT /api/answer
Upserts one text/select answer. Called on debounce (~1s after typing stops)
or on field blur — not on a big "submit" action.

**Body:**
```json
{ "entryId": "uuid", "questionId": "ch03_q1", "text": "I remember..." }
```
**Response 200:** `{ "saved": true, "updatedAt": "2026-06-29T..." }`

### POST /api/answer/photo
Uploads a photo for a specific photo-type question (e.g. ch03_q8) and links
it as that question's answer. Multipart form upload.

**Body (multipart):** `entryId`, `questionId`, `caption` (optional), `file`

**Response 200:**
```json
{ "saved": true, "photoUrl": "https://.../signed-url" }
```
Server-side: validates file is an image, resizes/compresses before storing
(keeps Storage usage low and PDF generation fast), stores in
`books/{bookId}/{entryId}/{questionId}.jpg`, overwriting any previous photo
for that question.

### POST /api/bonus-photo
Adds an open-ended bonus photo to a chapter entry. Multipart form upload.

**Body (multipart):** `entryId`, `caption` (optional), `file`

**Response 200:** `{ "id": "uuid", "photoUrl": "https://.../signed-url" }`

### DELETE /api/bonus-photo/:id
Removes a bonus photo (and its file from Storage).

**Response 200:** `{ "deleted": true }`

---

## Chapter 8 — people management

### POST /api/people
Adds a new person entry under Chapter 8.

**Body:** `{ "name": "Sophie", "relationship": "Daughter" }`
**Response 200:** `{ "entryId": "uuid", "name": "Sophie", "relationship": "Daughter" }`

### PATCH /api/people/:entryId
Edits a person's name/relationship.

**Body:** `{ "name": "Sophie", "relationship": "Granddaughter" }`
**Response 200:** `{ "updated": true }`

### DELETE /api/people/:entryId
Removes a person and all their answers/photos for Chapter 8.

**Response 200:** `{ "deleted": true }`

---

## Finishing the book

### POST /api/book/finish
Marks the book as finished, triggers PDF generation (async — see below),
and on completion emails both the user and the admin with a link/attachment.

**Response 202 (Accepted — processing has started):**
```json
{ "status": "generating", "bookId": "uuid" }
```

### GET /api/book/pdf-status
Frontend polls this after calling finish, to show "your book is ready!"

**Response 200:**
```json
{ "status": "ready", "pdfUrl": "https://.../signed-url" }
```
or `{ "status": "generating" }` or `{ "status": "failed", "error": "..." }`

Internally: the finish endpoint flips `books.status` to `finished`, kicks off
PDF generation as a background task (not blocking the HTTP response — PDF
rendering with embedded photos can take a several seconds to a minute), and
once done, stores the result at `books.pdf_storage_path` and sends emails.

---

## Admin endpoints
All require `profiles.role = 'admin'`. Returns 403 otherwise.

### GET /api/admin/users
Lists every author with progress summary.

**Response 200:**
```json
[
  {
    "userId": "uuid",
    "displayName": "Jane",
    "bookStatus": "in_progress",
    "chaptersComplete": 4,
    "chaptersTotal": 12,
    "lastUpdated": "2026-06-28T10:00:00Z"
  }
]
```

### GET /api/admin/book/:userId
Same shape as `GET /api/book`, but for any user — lets you review someone's
progress or jump to their finished PDF.

### GET /api/admin/book/:userId/pdf
Returns the signed download URL for that user's finished PDF, once ready.

---

## Error handling conventions
- `401` — missing/invalid auth token
- `403` — authenticated, but not allowed (e.g. non-admin hitting admin routes, or trying to touch another user's entry)
- `404` — resource doesn't exist (e.g. unknown chapterId, deleted person entry)
- `422` — validation failure (e.g. uploading a non-image file, missing required field)
- `500` — unexpected server error; logged server-side, generic message returned to client

All error responses share a shape: `{ "error": "human readable message" }`
