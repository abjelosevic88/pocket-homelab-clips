# Backup & restore

Everything lives in `DATA_DIR` (`/data` in the container):

```
/data/pocket-clips.db     # the SQLite database (WAL mode: -wal / -shm files appear while running)
/data/images/             # image clips, one file per distinct image (sha256-named)
/data/backups/            # VACUUM INTO copies made by the CLI
```

## Making a backup

- **UI:** Settings → Backup & data → *Download database*.
- **CLI:** `docker exec pocket-clips pocket-clips backup` (or `backup -o /data/backups/named.db`).
- **API:** `GET /api/v1/backup` with a token.
- **Portable:** Settings → Backup & data → *Export library* gives your snippets and quicklinks as JSON (add `?clips=1` for text clips too). It re-imports on any instance.

All of these produce a consistent snapshot even while the app is writing. Copying `pocket-clips.db` raw while the container runs can give you a torn file because of the WAL.

### With restic / Borg / Backrest / Kopia

Add `DATA_DIR` to your backup set, **exclude** `pocket-clips.db*` and `backups/`, and run the CLI backup (or the sqlite3 `.backup` command) as a pre-snapshot hook so the consistent copy is what gets picked up. `images/` is plain files and can be backed up as is.

## Restoring

```bash
docker compose stop pocket-clips
cp pocket-clips-20261015-030000.db data/pocket-clips.db
rm -f data/pocket-clips.db-wal data/pocket-clips.db-shm
docker compose start pocket-clips
```

Or start a fresh instance and import the library JSON.
