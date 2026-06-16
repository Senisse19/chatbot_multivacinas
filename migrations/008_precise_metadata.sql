-- Migration 008: Enriquecimento Preciso de Metadados baseados em ID Ranges
-- Garante que 100% dos chunks de bulas e calendários possuam os campos 'tipo',
-- 'vacina' e 'faixa_etaria' perfeitamente configurados.

BEGIN;

-- 1. Reset/Inicializar tipo e limpar campos vacina/faixa_etaria antigos para evitar inconsistências
UPDATE documents
SET metadata = metadata - 'vacina' - 'faixa_etaria' - 'tipo';

-- 2. Definir o campo 'tipo'
UPDATE documents
SET metadata = metadata || '{"tipo": "calendario"}'::jsonb
WHERE id BETWEEN 116 AND 386
   OR id BETWEEN 2796 AND 2823
   OR id BETWEEN 2906 AND 2928
   OR id BETWEEN 2951 AND 3034;

UPDATE documents
SET metadata = metadata || '{"tipo": "bula"}'::jsonb
WHERE (metadata->>'tipo') IS NULL;

-- 3. Atualizar Bulas por faixas de ID sequenciais (Ingestão original)
-- 387 a 475: Arexvy
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'arexvy',
  'faixa_etaria', CASE
    WHEN content ILIKE '%60 anos%' OR content ILIKE '%idoso%' THEN 'idoso'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 387 AND 475;

-- 476 a 589: Bexsero
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'bexsero',
  'faixa_etaria', CASE
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    WHEN content ILIKE '%adulto%' THEN 'adulto'
    ELSE 'crianca'
  END
)
WHERE id BETWEEN 476 AND 589;

-- 590 a 653: Influvac Tetra
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'influvac_tetra',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 590 AND 653;

-- 654 a 732: Efluelda
UPDATE documents
SET metadata = metadata || '{"vacina": "efluelda", "faixa_etaria": "idoso"}'::jsonb
WHERE id BETWEEN 654 AND 732;

-- 733 a 799: FluQuadri
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'fluquadri',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 733 AND 799;

-- 800 a 860: Typhim VI
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'typhim_vi',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 800 AND 860;

-- 861 a 973: Stamaril
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'stamaril',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 861 AND 973;

-- 974 a 1082: Engerix B
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'engerix_b',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%recém-nascido%' OR content ILIKE '%neonatal%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 974 AND 1082;

-- 1083 a 1292: Gardasil 9
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'gardasil_9',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%9 anos%' THEN 'crianca'
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 1083 AND 1292;

-- 1293 a 1395: Infanrix Hexa
UPDATE documents
SET metadata = metadata || '{"vacina": "infanrix_hexa", "faixa_etaria": "crianca"}'::jsonb
WHERE id BETWEEN 1293 AND 1395;

-- 1396 a 1464: Infanrix Penta
UPDATE documents
SET metadata = metadata || '{"vacina": "infanrix_penta", "faixa_etaria": "crianca"}'::jsonb
WHERE id BETWEEN 1396 AND 1464;

-- 1465 a 1613: Menveo
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'menveo',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 1465 AND 1613;

-- 1614 a 1818: Prevenar 20
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'prevenar_20',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 1614 AND 1818;

-- 1819 a 1924: ProQuad
UPDATE documents
SET metadata = metadata || '{"vacina": "proquad", "faixa_etaria": "crianca"}'::jsonb
WHERE id BETWEEN 1819 AND 1924;

-- 1925 a 2120: Qdenga
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'qdenga',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 1925 AND 2120;

-- 2121 a 2212: Refortrix
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'refortrix',
  'faixa_etaria', CASE
    WHEN content ILIKE '%adolescente%' THEN 'adolescente'
    WHEN content ILIKE '%gestante%' OR content ILIKE '%grávida%' OR content ILIKE '%gravidez%' THEN 'gestante'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 2121 AND 2212;

-- 2213 a 2296: RotaTeq
UPDATE documents
SET metadata = metadata || '{"vacina": "rotateq", "faixa_etaria": "crianca"}'::jsonb
WHERE id BETWEEN 2213 AND 2296;

-- 2297 a 2397: Shingrix
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'shingrix',
  'faixa_etaria', CASE
    WHEN content ILIKE '%50 anos%' OR content ILIKE '%60 anos%' OR content ILIKE '%idoso%' THEN 'idoso'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 2297 AND 2397;

-- 2398 a 2475: Twinrix
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'twinrix',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 2398 AND 2475;

-- 2476 a 2552: Vaqta
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'vaqta',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 2476 AND 2552;

-- 2553 a 2649: Varivax
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'varivax',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 2553 AND 2649;

-- 2650 a 2795: Vaxneuvance
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'vaxneuvance',
  'faixa_etaria', CASE
    WHEN content ILIKE '%criança%' OR content ILIKE '%infantil%' OR content ILIKE '%meses%' THEN 'crianca'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 2650 AND 2795;

-- 2824 a 2905: Abrysvo
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'vacina', 'abrysvo',
  'faixa_etaria', CASE
    WHEN content ILIKE '%gestante%' OR content ILIKE '%gravidez%' OR content ILIKE '%grávida%' OR content ILIKE '%parto%' THEN 'gestante'
    WHEN content ILIKE '%60 anos%' OR content ILIKE '%idoso%' THEN 'idoso'
    ELSE 'adulto'
  END
)
WHERE id BETWEEN 2824 AND 2905;


-- 4. Enriquecer Calendários com 'faixa_etaria' baseada no tipo de calendário
-- 116 a 386: Calendários diversos
UPDATE documents
SET metadata = metadata || jsonb_build_object(
  'faixa_etaria', CASE
    WHEN content ILIKE '%CRIANÇA%' OR content ILIKE '%PREMATURO%' THEN 'crianca'
    WHEN content ILIKE '%ADOLESCENTE%' THEN 'adolescente'
    WHEN content ILIKE '%GESTANTE%' THEN 'gestante'
    WHEN content ILIKE '%IDOSO%' THEN 'idoso'
    WHEN content ILIKE '%ADULTO%' OR content ILIKE '%OCUPACIONAL%' THEN 'adulto'
    ELSE 'todos'
  END
)
WHERE id BETWEEN 116 AND 386;

-- 2796 a 2811: Calendário Adulto
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "adulto"}'::jsonb
WHERE id BETWEEN 2796 AND 2811;

-- 2812 a 2823: Calendário Adolescente
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "adolescente"}'::jsonb
WHERE id BETWEEN 2812 AND 2823;

-- 2906 a 2910: Esquemas Pneumocócica (Todos/Especiais)
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "todos"}'::jsonb
WHERE id BETWEEN 2906 AND 2910;

-- 2911 a 2927: Calendário Prematuro
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "crianca"}'::jsonb
WHERE id BETWEEN 2911 AND 2927;

-- 2928 a 2950: Pacientes Especiais / Diretrizes
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "todos"}'::jsonb
WHERE id BETWEEN 2928 AND 2950;

-- 2951 a 2964: Calendário Ocupacional
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "adulto"}'::jsonb
WHERE id BETWEEN 2951 AND 2964;

-- 2965 a 2978: Calendário Idoso
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "idoso"}'::jsonb
WHERE id BETWEEN 2965 AND 2978;

-- 2979 a 3001: Calendário Criança
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "crianca"}'::jsonb
WHERE id BETWEEN 2979 AND 3001;

-- 3002 a 3009: Calendário Vacinal SBIm 2025/2026 (Do nascimento à terceira idade)
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "todos"}'::jsonb
WHERE id BETWEEN 3002 AND 3009;

-- 3010 a 3014: Do nascimento aos 19 anos
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "todos"}'::jsonb
WHERE id BETWEEN 3010 AND 3014;

-- 3015 a 3021: Dos 20 anos aos 60+
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "adulto"}'::jsonb
WHERE id BETWEEN 3015 AND 3021;

-- 3022 a 3034: Calendário Gestante
UPDATE documents
SET metadata = metadata || '{"faixa_etaria": "gestante"}'::jsonb
WHERE id BETWEEN 3022 AND 3034;

COMMIT;
