"""Repeatable SQLite -> PostgreSQL importer.

Use after Flyway: pip install psycopg[binary], then run this script with
SQLITE_PATH and DATABASE_URL. It copies only common columns, preserving IDs and
foreign-key order. The target database must be empty (except reference seeds).
"""
import os, sqlite3
import psycopg

source = sqlite3.connect(os.environ["SQLITE_PATH"])
target = psycopg.connect(os.environ["DATABASE_URL"])
tables = [r[0] for r in source.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
with target, target.cursor() as cur:
    for table in tables:
        source_columns = [r[1] for r in source.execute(f'pragma table_info("{table}")')]
        target_columns = {r[0] for r in cur.execute("select column_name from information_schema.columns where table_schema='public' and table_name=%s", (table,))}
        columns = [c for c in source_columns if c in target_columns]
        if not columns: continue
        placeholders = ",".join(["%s"] * len(columns)); quoted = ",".join(f'"{c}"' for c in columns)
        for row in source.execute(f'select {quoted} from "{table}"'):
            cur.execute(f'insert into "{table}" ({quoted}) values ({placeholders}) on conflict do nothing', row)
print("SQLite import completed")
