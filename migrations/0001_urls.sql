BEGIN;
CREATE TABLE public.urls (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    original_url TEXT NOT NULL CHECK (octet_length(original_url) BETWEEN 1 AND 8192),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON TABLE public.urls FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO shortener_app;
GRANT SELECT (id, original_url) ON public.urls TO shortener_app;
GRANT INSERT (original_url) ON public.urls TO shortener_app;
-- IDENTITY generates its value without granting nextval/setval access.
REVOKE ALL ON SEQUENCE public.urls_id_seq FROM PUBLIC, shortener_app;
COMMIT;
