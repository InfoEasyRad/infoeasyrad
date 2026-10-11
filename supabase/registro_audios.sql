-- ════════════════════════════════════════════════════════════════════
-- InfoEasyRad · Registro de audios
-- Correr UNA vez en Supabase → SQL Editor → New query → pegar todo → Run.
-- Es idempotente: si se corre de nuevo no rompe ni borra nada.
-- ════════════════════════════════════════════════════════════════════

-- 1) Tabla del registro ------------------------------------------------
create table if not exists public.registro_audios (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  paciente_nombre  text not null check (char_length(paciente_nombre) between 1 and 200),
  nombre_busqueda  text not null default '',   -- nombre sin tildes y en minúsculas, para buscar
  paciente_edad    text check (paciente_edad is null or char_length(paciente_edad) <= 40),
  fecha_estudio    date not null default current_date,
  modalidad        text check (modalidad is null or char_length(modalidad) <= 60),
  storage_path     text not null unique,
  mime_type        text,
  tamano_bytes     bigint,
  duracion_seg     integer,
  origen           text not null default 'grabacion'
                   check (origen in ('grabacion', 'archivo')),
  estado           text not null default 'subiendo'
                   check (estado in ('subiendo', 'pendiente', 'transcrito', 'informado', 'descartado')),
  transcripcion    text,
  transcrito_at    timestamptz,
  informado_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists registro_audios_user_estado_idx
  on public.registro_audios (user_id, estado, created_at desc);

-- 2) Seguridad --------------------------------------------------------
-- RLS (Row Level Security) activado y SIN políticas para anon/authenticated:
-- nadie puede leer la tabla directo desde el navegador. Solo las funciones
-- de Vercel (service role) acceden, y siempre filtran por el usuario del token.
alter table public.registro_audios enable row level security;
-- Permiso explícito para las funciones del servidor (por si el proyecto no
-- concede permisos automáticos a las tablas nuevas).
grant select, insert, update, delete on table public.registro_audios to service_role;

-- 3) updated_at automático --------------------------------------------
create or replace function public.registro_audios_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace trigger registro_audios_touch
  before update on public.registro_audios
  for each row execute function public.registro_audios_touch();

-- 4) Bucket PRIVADO para los audios -----------------------------------
-- 25 MB por archivo (= límite de Whisper). Sin políticas de storage: el
-- navegador solo puede subir con una URL firmada de un solo uso que genera
-- la función del servidor, y solo puede escuchar con URLs firmadas de 10 min.
insert into storage.buckets (id, name, public, file_size_limit)
values ('audios-registro', 'audios-registro', false, 26214400)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- Nota: al borrar un usuario, sus filas se borran solas (on delete cascade),
-- pero los archivos no: hay que borrar también la carpeta <user_id>/ del bucket.

-- Que la API de Supabase vea la tabla nueva sin esperar
notify pgrst, 'reload schema';

-- 5) Verificación (debe devolver 1 fila con public = false) ------------
select id, public, file_size_limit from storage.buckets where id = 'audios-registro';
