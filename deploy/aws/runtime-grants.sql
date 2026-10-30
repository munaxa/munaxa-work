-- The runtime role's standing grant (docs/DEVELOPMENT.md, ADR-0079), applied by the migrate job on
-- the shared AWS stack after `prisma migrate deploy`, as the owner role that ran the migrations.
--
-- work_app gets data access and nothing else: no DDL, no ownership, no BYPASSRLS (it is created
-- NOBYPASSRLS by the stack's db-admin task), so every tenant table's row-level security policies
-- apply to it. The default privileges cover tables a later migration creates before this file is
-- applied again.
GRANT USAGE ON SCHEMA public TO work_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO work_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO work_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO work_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO work_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO work_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO work_app;
-- Prisma's own bookkeeping is the owner's alone.
REVOKE ALL ON TABLE _prisma_migrations FROM work_app;
