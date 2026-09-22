-- Fix false INVALID_PRESET_PATH failures for otherwise valid UUID-based paths.
--
-- PostgreSQL LIKE treats `%` as a wildcard. The former checks such as
-- `lower(path) like '%2e%'` therefore matched ordinary UUID text containing
-- `2e`, rather than only the literal percent-encoded traversal sequence `%2e`.
-- Keep both reservation functions backward-compatible and replace only those
-- three predicates in their existing definitions.

do $migration$
declare
  v_signature text;
  v_function_oid oid;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.reserve_photo_upload(uuid,uuid,text,text,text,text,bigint,text,text,uuid,text,boolean,boolean)',
    'public.reserve_camera_photo_upload(uuid,text,text,text,text,bigint,text,text,text,boolean,boolean)'
  ]
  loop
    v_function_oid := to_regprocedure(v_signature)::oid;

    if v_function_oid is null then
      raise exception 'Required upload reservation function is missing: %', v_signature;
    end if;

    select pg_get_functiondef(v_function_oid)
    into v_definition;

    if strpos(v_definition, 'lower(p_preset_path) like ''%2e%''') > 0 then
      v_definition := replace(
        v_definition,
        'lower(p_preset_path) like ''%2e%''',
        'position(''%2e'' in lower(p_preset_path)) > 0'
      );
      v_definition := replace(
        v_definition,
        'lower(p_preset_path) like ''%2f%''',
        'position(''%2f'' in lower(p_preset_path)) > 0'
      );
      v_definition := replace(
        v_definition,
        'lower(p_preset_path) like ''%5c%''',
        'position(''%5c'' in lower(p_preset_path)) > 0'
      );

      execute v_definition;
    elsif strpos(
      v_definition,
      'position(''%2e'' in lower(p_preset_path)) > 0'
    ) = 0 then
      raise exception 'Unexpected preset validation definition: %', v_signature;
    end if;
  end loop;
end;
$migration$;
