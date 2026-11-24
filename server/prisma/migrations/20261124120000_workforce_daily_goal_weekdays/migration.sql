BEGIN;

ALTER TABLE "WorkforceEmployee"
ADD COLUMN "dailyGoalWeekdayHistory" JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Registra el horario conocido a partir del día local siguiente a la migración.
UPDATE "WorkforceEmployee" AS employee
SET "dailyGoalWeekdayHistory" = jsonb_build_object(
  to_char((statement_timestamp() AT TIME ZONE COALESCE((
    SELECT name FROM pg_timezone_names WHERE name = employee."timezone"
  ), 'America/Mexico_City'))::date + 1, 'YYYY-MM-DD'),
  employee."workScheduleWeekdayMask"
)
WHERE employee."workScheduleWeekdayMask" BETWEEN 1 AND 127;

CREATE FUNCTION record_workforce_daily_goal_weekdays() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  effective_date date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."workScheduleWeekdayMask" IS NOT DISTINCT FROM OLD."workScheduleWeekdayMask" THEN
      RETURN NEW;
    END IF;
  ELSIF NEW."workScheduleWeekdayMask" IS NULL THEN
    RETURN NEW;
  END IF;

  effective_date := (clock_timestamp() AT TIME ZONE NEW."timezone")::date;
  -- Un cambio de horario afecta desde el día siguiente del colaborador.
  IF TG_OP = 'UPDATE' THEN
    effective_date := effective_date + 1;
  END IF;
  NEW."dailyGoalWeekdayHistory" := NEW."dailyGoalWeekdayHistory" || jsonb_build_object(
    to_char(effective_date, 'YYYY-MM-DD'), NEW."workScheduleWeekdayMask"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER record_workforce_daily_goal_weekdays
BEFORE INSERT OR UPDATE OF "workScheduleWeekdayMask" ON "WorkforceEmployee"
FOR EACH ROW EXECUTE FUNCTION record_workforce_daily_goal_weekdays();

COMMIT;
