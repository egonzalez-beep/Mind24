ALTER TABLE "KioskEmployeeSchedule"
    ADD COLUMN "weekendHours" JSONB NOT NULL DEFAULT '{}',
    ADD CONSTRAINT "KioskEmployeeSchedule_weekend_hours_check" CHECK (
        jsonb_typeof("weekendHours") = 'object'
        AND ("weekendHours" - ARRAY['6', '7']) = '{}'::jsonb
        AND (NOT ("weekendHours" ? '6') OR ("weekdayMask" & 32) <> 0)
        AND (NOT ("weekendHours" ? '7') OR ("weekdayMask" & 64) <> 0)
    );
