# File Storage

ChadStart supports file uploads and downloads via named storage buckets.

## Configuration

Define file buckets in `chadstart.yaml`:

```yaml
files:
  uploads:
    path: ./uploads
    public: true
```

| Option | Description |
|--------|-------------|
| `path` | Local directory to store files |
| `public` | If `true`, files are publicly accessible via GET |

## Upload a File

```bash
curl -F "file=@photo.jpg" http://localhost:3000/files/uploads
```

Returns:

```json
{ "filename": "photo.jpg", "url": "/files/uploads/photo.jpg" }
```

## Download a File

```
GET /files/uploads/photo.jpg
```

## Multiple Buckets

```yaml
files:
  avatars:
    path: ./uploads/avatars
    public: true
  documents:
    path: ./uploads/documents
    public: false
```

Private buckets (`public: false`) require authentication to access.
