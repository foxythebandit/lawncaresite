// Which SQL the migration checker calls destructive. Built from Bread's shared-collections migration
// (2026-11-12), which only added tables and "remove" functions but was flagged as deleting data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grepHits } from '../scripts/check-migrations.mjs';

const removeFn = `create function private.remove_verse_from_collection(p_user uuid, p_verse uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.verse_collections where verse_id = p_verse;
end;
$$;`;

test('a delete inside a new function runs later, so the migration is not destructive', () => {
  assert.deepEqual(grepHits(`create table public.shared_collections (id uuid primary key);\n${removeFn}`), []);
});

test('grants, triggers and policies that name the function are not calls', () => {
  const sql = `${removeFn}
grant execute on function private.remove_verse_from_collection(uuid, uuid) to authenticated;
create trigger t after delete on public.x for each row execute function private.remove_verse_from_collection();
create policy p on public.x for delete using (true);`;
  assert.deepEqual(grepHits(sql), []);
});

test('a delete that runs during the migration is destructive', () => {
  assert.deepEqual(grepHits('delete from public.user_verses where user_id is null;'), ['delete from']);
  assert.deepEqual(grepHits('truncate public.user_verses;'), ['truncate']);
  assert.deepEqual(grepHits('do $$ begin delete from public.x; end $$;'), ['delete from']);
});

test('calling a deleting function from the migration is destructive', () => {
  assert.deepEqual(grepHits(`${removeFn}\nselect private.remove_verse_from_collection(null, id) from public.x;`),
    ['calls remove_verse_from_collection, which deletes']);
  assert.deepEqual(grepHits(`${removeFn}\ndo $$ begin perform private.remove_verse_from_collection(null, null); end $$;`),
    ['calls remove_verse_from_collection, which deletes']);
});

test('a commented-out delete does not count', () => {
  assert.deepEqual(grepHits('-- delete from public.x;\n/* truncate public.x; */ select 1;'), []);
});
