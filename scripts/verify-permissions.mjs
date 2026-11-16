import assert from 'node:assert/strict';
import {sql, mappings} from './db-test-helpers.mjs';
const id = sql("INSERT INTO public.urls(original_url) VALUES ('https://example.com/m2-permission') RETURNING id").split('\n')[0].trim();
assert.match(id, /^\d+$/);
assert.equal(sql(`SELECT original_url FROM public.urls WHERE id=${id}`), 'https://example.com/m2-permission');
const before = mappings();
const attempts = [
  ['UPDATE', `UPDATE public.urls SET original_url='https://example.com/changed' WHERE id=${id}`],
  ['DELETE', `DELETE FROM public.urls WHERE id=${id}`],
  ['TRUNCATE', 'TRUNCATE public.urls'],
  ['CREATE', 'CREATE TABLE public.m2_forbidden_table (id int)'],
  ['ALTER', 'ALTER TABLE public.urls ADD COLUMN m2_forbidden int'],
  ['DROP', 'DROP TABLE public.urls'],
  ['manual ID', "INSERT INTO public.urls(id,original_url) VALUES (999999,'https://example.com/manual')"],
  ['OVERRIDING ID', "INSERT INTO public.urls(id,original_url) OVERRIDING SYSTEM VALUE VALUES (999999,'https://example.com/manual')"],
  ['setval', "SELECT setval('public.urls_id_seq',999999)"],
  ['nextval', "SELECT nextval('public.urls_id_seq')"],
  ['sequence restart', 'ALTER SEQUENCE public.urls_id_seq RESTART WITH 999999'],
  ['role escalation', 'SET ROLE shortener_migrator'],
];
for (const [name, statement] of attempts) {
  // DML/DDL rolls back on disconnect. Sequence changes are not transactional:
  // this script is restricted to the disposable, dedicated M2 database.
  const result = sql(`BEGIN; ${statement}; ROLLBACK;`, 'shortener_app', true);
  assert.notEqual(result.code, 0, `${name} must be denied`);
  assert.match(result.error, /42501|428C9/, `${name} must fail due to authorization/identity`);
  console.log(`PASS: restricted app denied ${name}`);
}
assert.deepEqual(mappings(), before, 'denied operations cannot change existing mappings');
const flags = sql("SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit FROM pg_roles WHERE rolname=current_user");
assert.equal(flags, 'f');
assert.equal(sql("SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.urls'::regclass"), 'shortener_migrator');
assert.equal(sql("SELECT has_sequence_privilege(current_user,'public.urls_id_seq','USAGE, SELECT, UPDATE')"), 'f');
console.log('PASS: INSERT/SELECT, ownership separation, no privileged flags, no sequence privileges, immutable mappings');
