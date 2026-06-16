-- Migration 007: Enriquecimento de Metadados
-- Adiciona os campos 'tipo', 'vacina' e 'faixa_etaria' ao JSONB 'metadata'
-- dos chunks existentes para habilitar o funcionamento correto dos RagFilters.

BEGIN;

-- 1. Inicializar todas como tipo = 'bula'
UPDATE documents
SET metadata = metadata || '{"tipo": "bula"}'::jsonb;

-- 2. Atualizar tipo = 'calendario' para os intervalos correspondentes a calendários e diretrizes
UPDATE documents
SET metadata = metadata || '{"tipo": "calendario"}'::jsonb
WHERE id BETWEEN 116 AND 386
   OR id BETWEEN 2796 AND 2823
   OR id BETWEEN 2906 AND 3034;

-- 3. Enriquecer Bulas com 'vacina' e 'faixa_etaria'
-- Abrysvo
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'abrysvo',
  'faixa_etaria', CASE
    WHEN content ILIKE '%gestante%' OR content ILIKE '%gravidez%' OR content ILIKE '%grávida%' OR content ILIKE '%parto%' THEN 'gestante'
    WHEN content ILIKE '%60 anos%' OR content ILIKE '%idoso%' THEN 'idoso'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Abrysvo%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Arexvy
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'arexvy',
  'faixa_etaria', CASE
    WHEN content ILIKE '%60 anos%' OR content ILIKE '%idoso%' THEN 'idoso'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Arexvy%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Beyfortus
UPDATE documents
SET metadata = metadata || '{"vacina": "beyfortus", "faixa_etaria": "crianca"}'::jsonb
WHERE content ILIKE '%Beyfortus%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Efluelda
UPDATE documents
SET metadata = metadata || '{"vacina": "efluelda", "faixa_etaria": "idoso"}'::jsonb
WHERE content ILIKE '%Efluelda%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Qdenga
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'qdenga',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Qdenga%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Shingrix
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'shingrix',
  'faixa_etaria', CASE
    WHEN content ILIKE '%50 anos%' OR content ILIKE '%60 anos%' OR content ILIKE '%idoso%' THEN 'idoso'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Shingrix%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Prevenar 20
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'prevenar_20',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Prevenar%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Vaxneuvance
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'vaxneuvance',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Vaxneuvance%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Gardasil 9
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'gardasil_9',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%9 anos%' THEN 'crianca'
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Gardasil%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Stamaril
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'stamaril',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Stamaril%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Typhim VI
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'typhim_vi',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Typhim%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- FluQuadri
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'fluquadri',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%FluQuadri%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Influvac Tetra
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'influvac_tetra',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Influvac%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Engerix B
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'engerix_b',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%recém-nascido%' OR content ILIKE '%neonatal%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Engerix%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- ProQuad
UPDATE documents
SET metadata = metadata || '{"vacina": "proquad", "faixa_etaria": "crianca"}'::jsonb
WHERE content ILIKE '%ProQuad%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Refortrix
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'refortrix',
  'faixa_etaria', CASE
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    WHEN content ILIKE '%gestante%' OR content ILIKE '%grávida%' OR content ILIKE '%gravidez%' THEN 'gestante'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Refortrix%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Rotateq
UPDATE documents
SET metadata = metadata || '{"vacina": "rotateq", "faixa_etaria": "crianca"}'::jsonb
WHERE content ILIKE '%RotaTeq%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Twinrix
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'twinrix',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Twinrix%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Vaqta
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'vaqta',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Vaqta%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Varivax
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'varivax',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Varivax%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Bexsero
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'bexsero',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE content ILIKE '%Bexsero%' AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Menveo
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'menveo',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    ELSE 'adulto'
  END
)
WHERE (content ILIKE '%Menveo%' OR (content ILIKE '%Meningocócica%' AND NOT (content ILIKE '%Bexsero%'))) AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Infanrix Hexa
UPDATE documents
SET metadata = metadata || '{"vacina": "infanrix_hexa", "faixa_etaria": "crianca"}'::jsonb
WHERE content ILIKE '%Infanrix%' AND (content ILIKE '%hexa%' OR id BETWEEN 1293 AND 1370) AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);

-- Infanrix Penta
UPDATE documents
SET metadata = metadata || '{"vacina": "infanrix_penta", "faixa_etaria": "crianca"}'::jsonb
WHERE content ILIKE '%Infanrix%' AND (content ILIKE '%penta%' OR id BETWEEN 1396 AND 1439) AND NOT (id BETWEEN 116 AND 386 OR id BETWEEN 2796 AND 2823 OR id BETWEEN 2906 AND 3034);


-- 4. Enriquecer Calendários com 'faixa_etaria' baseada no tipo de calendário
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'faixa_etaria', CASE
    WHEN content ILIKE '%CRIANÇA%' OR content ILIKE '%PREMATURO%' THEN 'crianca'
    WHEN content ILIKE '%ADOLESCENTE%' THEN 'adolescente'
    WHEN content ILIKE '%GESTANTE%' THEN 'gestante'
    WHEN content ILIKE '%IDOSO%' THEN 'idoso'
    WHEN content ILIKE '%ADULTO%' OR content ILIKE '%OCUPACIONAL%' OR content ILIKE '%DOS 20 ANOS AOS 60+%' THEN 'adulto'
    ELSE 'todos'
  END
)
WHERE id BETWEEN 116 AND 386
   OR id BETWEEN 2796 AND 2823
   OR id BETWEEN 2906 AND 3034;

COMMIT;
