-- Приводимо наявні номери до вигляду +380 XX XXX XX XX (українські; інші залишаються як є).
UPDATE "clients" SET "phone" = NULL WHERE "phone" IS NOT NULL AND btrim("phone") = '';
--> statement-breakpoint
WITH d AS (
  SELECT "id", regexp_replace("phone", '\D', '', 'g') AS digits FROM "clients" WHERE "phone" IS NOT NULL
), n AS (
  SELECT "id",
    CASE
      WHEN length(digits) = 12 AND left(digits, 3) = '380' THEN substr(digits, 4)
      WHEN length(digits) = 11 AND left(digits, 2) = '80' THEN substr(digits, 3)
      WHEN length(digits) = 10 AND left(digits, 1) = '0' THEN substr(digits, 2)
      WHEN length(digits) = 9 AND left(digits, 1) <> '0' THEN digits
    END AS nat
  FROM d
)
UPDATE "clients" c
SET "phone" = '+380 ' || substr(n.nat, 1, 2) || ' ' || substr(n.nat, 3, 3) || ' ' || substr(n.nat, 6, 2) || ' ' || substr(n.nat, 8, 2)
FROM n
WHERE c."id" = n."id" AND n.nat IS NOT NULL AND left(n.nat, 1) <> '0';
