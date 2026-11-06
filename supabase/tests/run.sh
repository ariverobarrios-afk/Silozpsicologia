#!/usr/bin/env bash
# Pruebas de la base de datos del área privada (reserva de citas incluida).
#
# Necesita un servidor Postgres 15+ con la extensión btree_gist (el paquete
# postgresql-contrib) al que conectarse como superusuario. Crea una base de
# datos temporal, aplica bootstrap.sql (imitación de Supabase) y schema.sql
# dos veces (comprueba que es idempotente), ejecuta las pruebas y la borra.
#
#   TEST_PG_URL=postgresql://postgres@localhost:5432/postgres npm run test:db
#
# NUNCA lo apuntes a la base de datos de Supabase de producción.
set -euo pipefail
cd "$(dirname "$0")/../.."

ADMIN_URL="${TEST_PG_URL:-postgresql:///postgres}"
DB="siloz_test_$$"
DB_URL="$(echo "$ADMIN_URL" | sed -E "s#/[^/?]*(\?|$)#/$DB\1#")"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

cleanup() { "${PSQL[@]}" "$ADMIN_URL" -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fresh_db() {
  cleanup
  "${PSQL[@]}" "$ADMIN_URL" -c "create database $DB" >/dev/null
  "${PSQL[@]}" "$DB_URL" -f supabase/tests/bootstrap.sql >/dev/null
  "${PSQL[@]}" "$DB_URL" -f supabase/schema.sql >/dev/null 2>&1
}

echo "· schema.sql contiene la migración de reserva de citas"
python3 - <<'PY'
import sys
schema = open("supabase/schema.sql").read()
mig = open("supabase/migrations/20261106_reserva_citas_paciente.sql").read()
sys.exit(0 if mig.strip() in schema else "schema.sql no incluye la migración tal cual")
PY

echo "· aplicar schema.sql dos veces (idempotente)"
fresh_db
"${PSQL[@]}" "$DB_URL" -f supabase/schema.sql >/dev/null 2>&1

echo "· reglas de negocio y autorización"
"${PSQL[@]}" "$DB_URL" -o /dev/null -f supabase/tests/reserva_citas.test.sql 2>&1 | grep -v NOTICE

echo "· 10 pacientes reservan el mismo hueco a la vez"
fresh_db
"${PSQL[@]}" "$DB_URL" -f supabase/tests/concurrencia_setup.sql >/dev/null
SLOT=00000000-0000-0000-0000-000000000501
tmp="$(mktemp -d)"
for i in $(seq -w 1 10); do
  ( "${PSQL[@]}" "$DB_URL" -tA -c "set role service_role; select public.book_slot('00000000-0000-0000-0000-0000000001$i', '$SLOT')" \
      >"$tmp/$i.out" 2>"$tmp/$i.err" && echo ok >"$tmp/$i.res" || echo ko >"$tmp/$i.res" ) &
done
wait
oks=$(grep -l '^ok$' "$tmp"/*.res | wc -l)
unavailable=$(grep -l 'SLOT_UNAVAILABLE' "$tmp"/*.err | wc -l)
appts=$("${PSQL[@]}" "$DB_URL" -tA -c "select count(*) from public.appointments")
rm -rf "$tmp"
if [[ "$oks" != 1 || "$unavailable" != 9 || "$appts" != 1 ]]; then
  echo "FALLO: reservas OK=$oks, SLOT_UNAVAILABLE=$unavailable, citas=$appts (se esperaba 1, 9, 1)"; exit 1
fi

echo "· la segunda petición espera a la primera y recibe SLOT_UNAVAILABLE"
fresh_db
"${PSQL[@]}" "$DB_URL" -f supabase/tests/concurrencia_setup.sql >/dev/null
( "${PSQL[@]}" "$DB_URL" -tA -c "begin; set local role service_role;
    select public.book_slot('00000000-0000-0000-0000-000000000101', '$SLOT'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.7
if out=$("${PSQL[@]}" "$DB_URL" -tA -c "set role service_role; select public.book_slot('00000000-0000-0000-0000-000000000102', '$SLOT')" 2>&1); then
  wait; echo "FALLO: la segunda reserva prosperó: $out"; exit 1
fi
wait
grep -q SLOT_UNAVAILABLE <<<"$out" || { echo "FALLO: error inesperado: $out"; exit 1; }

echo "· un paciente reserva dos huecos de la misma semana a la vez: solo uno"
fresh_db
"${PSQL[@]}" "$DB_URL" -f supabase/tests/concurrencia_setup.sql >/dev/null
P=00000000-0000-0000-0000-000000000101
( "${PSQL[@]}" "$DB_URL" -tA -c "begin; set local role service_role;
    select public.book_slot('$P', '00000000-0000-0000-0000-000000000501'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.7
if out=$("${PSQL[@]}" "$DB_URL" -tA -c "set role service_role; select public.book_slot('$P', '00000000-0000-0000-0000-000000000502')" 2>&1); then
  wait; echo "FALLO: el paciente tiene dos citas la misma semana"; exit 1
fi
wait
grep -q WEEK_LIMIT <<<"$out" || { echo "FALLO: error inesperado: $out"; exit 1; }

echo "Todas las pruebas de base de datos OK"
