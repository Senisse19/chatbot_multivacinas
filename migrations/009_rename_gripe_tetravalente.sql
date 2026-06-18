-- Migration 009: Renomeia o slug da vacina da gripe para 'tetravalente'.
-- "Influvac" é marca de um único laboratório; a rede trabalha com mais de uma
-- vacina tetravalente da gripe. Unifica Influvac Tetra + FluQuadri (e o chunk de
-- contraindicação 'gripe') sob o slug genérico 'tetravalente'.
-- Efluelda (alta dose, idoso) permanece com slug próprio por ser clinicamente distinta.

BEGIN;

UPDATE documents
SET metadata = metadata || '{"vacina": "tetravalente"}'::jsonb
WHERE metadata->>'vacina' IN ('influvac_tetra', 'fluquadri', 'gripe');

COMMIT;
