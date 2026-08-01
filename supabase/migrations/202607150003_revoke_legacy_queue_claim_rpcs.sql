-- Remove client access from legacy queue-claim RPCs.
-- Production workers use claim_next_photo_job(text)
-- and claim_next_face_job(text) through service_role only.

revoke all
on function public.claim_photo_jobs(
  integer,
  integer,
  integer
)
from public;

revoke all
on function public.claim_photo_jobs(
  integer,
  integer,
  integer
)
from anon;

revoke all
on function public.claim_photo_jobs(
  integer,
  integer,
  integer
)
from authenticated;

revoke all
on function public.claim_face_jobs(
  integer,
  integer,
  integer
)
from public;

revoke all
on function public.claim_face_jobs(
  integer,
  integer,
  integer
)
from anon;

revoke all
on function public.claim_face_jobs(
  integer,
  integer,
  integer
)
from authenticated;

-- Keep service-role access only in case an older internal
-- maintenance script still calls these functions.
grant execute
on function public.claim_photo_jobs(
  integer,
  integer,
  integer
)
to service_role;

grant execute
on function public.claim_face_jobs(
  integer,
  integer,
  integer
)
to service_role;