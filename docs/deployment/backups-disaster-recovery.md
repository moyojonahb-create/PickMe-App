# Backup and Disaster Recovery

## PostgreSQL

Supabase-managed PostgreSQL should use Supabase PITR where available.

Operator export:

```bash
pg_dump "$DATABASE_URL" --format=custom --file "pickme-$(date +%F-%H%M).dump"
```

Restore rehearsal:

```bash
createdb pickme_restore_test
pg_restore --dbname pickme_restore_test --clean --if-exists pickme-YYYY-MM-DD-HHMM.dump
```

## Redis

Redis is used for cache, counters, Pub/Sub, and Asynq. Keep AOF enabled.

Backup:

```bash
docker compose exec redis redis-cli SAVE
docker cp "$(docker compose ps -q redis)":/data/dump.rdb ./redis-dump.rdb
docker cp "$(docker compose ps -q redis)":/data/appendonly.aof ./redis-appendonly.aof
```

Restore:

```bash
docker compose stop redis
docker cp ./redis-dump.rdb "$(docker compose ps -q redis)":/data/dump.rdb
docker compose start redis
```

## Uploads

Supabase Storage buckets to protect:

- driver documents
- student verification
- avatars
- deposit proofs

Use Supabase storage export tooling or scheduled object replication where available. Verify restore by sampling signed URLs and file metadata.

## Recovery Objectives

- Pilot RPO target: 15 minutes for PostgreSQL, 1 hour for uploads, best effort for Redis cache.
- Pilot RTO target: 60 minutes for API recovery, 4 hours for full audit/reporting recovery.

## Disaster Recovery Drill

1. Restore PostgreSQL into a staging project.
2. Restore Redis AOF/RDB into staging Redis.
3. Point staging backend to restored dependencies.
4. Run `/health/ready`, `/health/dependencies`, k6 smoke, wallet balance spot checks, and ride lifecycle smoke.
5. Record evidence in the launch readiness folder.
