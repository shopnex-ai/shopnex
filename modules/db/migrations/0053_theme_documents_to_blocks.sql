-- Saved themes written before their sections had blocks keep their content in numbered settings (image_1, heading_1…),
-- and the old announcement message in the theme's own settings. The themes no longer read either, so a saved theme would
-- show an empty hero, FAQ, quotes and no announcement. This moves that content into blocks, once, for every shop.
--
-- The formats are fixed history: KS BootShop, Shopco and Hydrogen moved to blocks on 2026-11-27 (#482, #484, #487), and
-- the announcement bar to blocks before that (#479). Only the document's shape is touched: updated_at is not, and what the
-- old documents are copied to is shop_themes_pre_blocks_backup, which a later migration may drop.
--
-- The helper functions are generic and stay for the next data migration of a theme document (rename a setting, move
-- settings into blocks…). All of them take a theme document and return it, never changing the one they are given.
--
-- A theme is converted one row at a time, its draft and published copy together, and a row that can't be converted (a
-- document of a shape nothing expected, a trigger or constraint refusing the update) is left exactly as it was and does not
-- stop the upgrade: a WARNING names it, and its `error` in shop_themes_pre_blocks_backup says why. A row that has nothing to
-- convert is not written at all.

-- Trims all whitespace (tabs and line breaks too), as JavaScript's trim does: btrim only trims spaces.
CREATE OR REPLACE FUNCTION shopnex_theme_trim(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g')
$$;
--> statement-breakpoint

-- Sections of `section_type` that have no list of blocks (an old one) get one block of `block_type` per position n in
-- 1..slots that has something: its settings are `mapping` (block setting -> old setting id, with {n} for the position).
-- The old settings of every position are removed. A section that has a list of blocks, even an empty one, is left alone:
-- it was saved after blocks, and what a merchant deleted stays deleted.
CREATE OR REPLACE FUNCTION shopnex_theme_blocks_from_settings(doc jsonb, section_type text, block_type text, mapping jsonb, slots int)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  result jsonb := doc;
  page_id text;
  page jsonb;
  sections jsonb;
  section jsonb;
  idx int;
  n int;
  entry record;
  old_key text;
  old_value jsonb;
  rest jsonb;
  blocks jsonb;
  block_settings jsonb;
BEGIN
  IF doc IS NULL OR jsonb_typeof(doc->'pages') IS DISTINCT FROM 'object' THEN
    RETURN doc;
  END IF;
  FOR page_id, page IN SELECT p.k, p.v FROM jsonb_each(doc->'pages') AS p(k, v) LOOP
    sections := page->'sections';
    IF jsonb_typeof(sections) IS DISTINCT FROM 'array' THEN
      CONTINUE;
    END IF;
    FOR idx IN 0..jsonb_array_length(sections) - 1 LOOP
      section := sections->idx;
      IF section->>'type' IS DISTINCT FROM section_type OR section ? 'blocks' THEN
        CONTINUE;
      END IF;
      blocks := '[]'::jsonb;
      rest := CASE WHEN jsonb_typeof(section->'settings') = 'object' THEN section->'settings' ELSE '{}'::jsonb END;
      FOR n IN 1..slots LOOP
        block_settings := '{}'::jsonb;
        FOR entry IN SELECT m.k AS block_setting, m.v AS pattern FROM jsonb_each_text(mapping) AS m(k, v) LOOP
          old_key := replace(entry.pattern, '{n}', n::text);
          old_value := section->'settings'->old_key;
          rest := rest - old_key;
          IF (jsonb_typeof(old_value) = 'string' AND shopnex_theme_trim(old_value #>> '{}') <> '') OR jsonb_typeof(old_value) = 'number' THEN
            block_settings := block_settings || jsonb_build_object(entry.block_setting, old_value);
          END IF;
        END LOOP;
        IF block_settings <> '{}'::jsonb THEN
          blocks := blocks || jsonb_build_array(
            jsonb_build_object('id', block_type || '-' || n, 'type', block_type, 'settings', block_settings)
          );
        END IF;
      END LOOP;
      IF jsonb_array_length(blocks) > 0 THEN
        sections := jsonb_set(sections, ARRAY[idx::text], (section - 'settings') || jsonb_build_object('settings', rest, 'blocks', blocks));
        result := jsonb_set(result, ARRAY['pages', page_id, 'sections'], sections);
      END IF;
    END LOOP;
  END LOOP;
  RETURN result;
END $$;
--> statement-breakpoint

-- Like shopnex_theme_blocks_from_settings, for an old text setting with one item per line (a brand strip's names): each
-- non-blank line (trimmed, at most `max_blocks`) becomes a block of `block_type` with the line as its `block_setting`. The
-- numbered position is the line's place among the non-blank lines.
CREATE OR REPLACE FUNCTION shopnex_theme_blocks_from_lines(doc jsonb, section_type text, block_type text, setting text, block_setting text, max_blocks int)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  result jsonb := doc;
  page_id text;
  page jsonb;
  sections jsonb;
  section jsonb;
  idx int;
  line text;
  n int;
  blocks jsonb;
BEGIN
  IF doc IS NULL OR jsonb_typeof(doc->'pages') IS DISTINCT FROM 'object' THEN
    RETURN doc;
  END IF;
  FOR page_id, page IN SELECT p.k, p.v FROM jsonb_each(doc->'pages') AS p(k, v) LOOP
    sections := page->'sections';
    IF jsonb_typeof(sections) IS DISTINCT FROM 'array' THEN
      CONTINUE;
    END IF;
    FOR idx IN 0..jsonb_array_length(sections) - 1 LOOP
      section := sections->idx;
      IF section->>'type' IS DISTINCT FROM section_type OR section ? 'blocks' OR jsonb_typeof(section->'settings'->setting) IS DISTINCT FROM 'string' THEN
        CONTINUE;
      END IF;
      blocks := '[]'::jsonb;
      n := 0;
      FOR line IN SELECT shopnex_theme_trim(l) FROM unnest(regexp_split_to_array(section->'settings'->>setting, E'\\r?\\n')) AS t(l) LOOP
        IF line <> '' AND n < max_blocks THEN
          n := n + 1;
          blocks := blocks || jsonb_build_array(
            jsonb_build_object('id', block_type || '-' || n, 'type', block_type, 'settings', jsonb_build_object(block_setting, line))
          );
        END IF;
      END LOOP;
      sections := jsonb_set(
        sections,
        ARRAY[idx::text],
        CASE WHEN jsonb_array_length(blocks) > 0
          THEN (section - 'settings') || jsonb_build_object('settings', (section->'settings') - setting, 'blocks', blocks)
          ELSE (section - 'settings') || jsonb_build_object('settings', (section->'settings') - setting)
        END
      );
      result := jsonb_set(result, ARRAY['pages', page_id, 'sections'], sections);
    END LOOP;
  END LOOP;
  RETURN result;
END $$;
--> statement-breakpoint

-- The old announcement message, kept in the theme's own settings (`text_key`, `link_key`, optionally a link label and a
-- show flag that is on unless stored false), becomes an announcement block of the global (static) announcement-bar
-- section, which is created when the document lacks it. The themes showed it only while no block had a text, so it is
-- added only then. The old settings are removed whatever happens.
CREATE OR REPLACE FUNCTION shopnex_theme_announcement_to_block(doc jsonb, text_key text, link_key text, link_label_key text, flag_key text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  result jsonb := doc;
  s jsonb;
  message text;
  visible boolean;
  sections jsonb;
  at_idx int := -1;
  idx int;
  blocks jsonb;
  has_text boolean := false;
  b jsonb;
  block_settings jsonb;
BEGIN
  IF doc IS NULL OR jsonb_typeof(doc->'settings') IS DISTINCT FROM 'object'
     OR (doc ? 'pages' AND jsonb_typeof(doc->'pages') IS DISTINCT FROM 'object')
     OR (doc->'pages' ? 'static' AND jsonb_typeof(doc->'pages'->'static') IS DISTINCT FROM 'object') THEN
    RETURN doc;
  END IF;
  s := doc->'settings';
  message := CASE WHEN jsonb_typeof(s->text_key) = 'string' THEN shopnex_theme_trim(s->>text_key) END;
  visible := flag_key IS NULL OR (s->flag_key) IS DISTINCT FROM 'false'::jsonb;

  IF message IS NOT NULL AND message <> '' AND visible THEN
    sections := coalesce(doc->'pages'->'static'->'sections', '[]'::jsonb);
    IF jsonb_typeof(sections) IS DISTINCT FROM 'array' THEN
      sections := '[]'::jsonb;
    END IF;
    FOR idx IN 0..jsonb_array_length(sections) - 1 LOOP
      IF sections->idx->>'type' = 'announcement-bar' THEN
        at_idx := idx;
        EXIT;
      END IF;
    END LOOP;
    blocks := CASE WHEN at_idx >= 0 AND jsonb_typeof(sections->at_idx->'blocks') = 'array' THEN sections->at_idx->'blocks' ELSE '[]'::jsonb END;
    FOR b IN SELECT e FROM jsonb_array_elements(blocks) AS t(e) LOOP
      IF jsonb_typeof(b->'settings'->'text') = 'string' AND shopnex_theme_trim(b->'settings'->>'text') <> '' THEN
        has_text := true;
      END IF;
    END LOOP;
    IF NOT has_text THEN
      block_settings := jsonb_build_object('text', message);
      IF jsonb_typeof(s->link_key) = 'string' AND shopnex_theme_trim(s->>link_key) <> '' THEN
        block_settings := block_settings || jsonb_build_object('link', s->link_key);
      END IF;
      IF link_label_key IS NOT NULL AND jsonb_typeof(s->link_label_key) = 'string' AND shopnex_theme_trim(s->>link_label_key) <> '' THEN
        block_settings := block_settings || jsonb_build_object('link_label', s->link_label_key);
      END IF;
      blocks := blocks || jsonb_build_array(
        jsonb_build_object('id', 'announcement-' || substr(md5(message), 1, 8), 'type', 'announcement', 'settings', block_settings)
      );
      IF at_idx >= 0 THEN
        sections := jsonb_set(sections, ARRAY[at_idx::text], (sections->at_idx) || jsonb_build_object('blocks', blocks));
      ELSE
        sections := sections || jsonb_build_array(
          jsonb_build_object('id', 'announcement-bar', 'type', 'announcement-bar', 'settings', '{}'::jsonb, 'blocks', blocks)
        );
      END IF;
      result := jsonb_set(
        result,
        '{pages}',
        coalesce(result->'pages', '{}'::jsonb) || jsonb_build_object('static', jsonb_build_object('sections', sections))
      );
    END IF;
  END IF;

  RETURN jsonb_set(
    result,
    '{settings}',
    (result->'settings') - text_key - link_key - coalesce(link_label_key, text_key) - coalesce(flag_key, text_key)
  );
END $$;
--> statement-breakpoint

-- The documents as they were, for a rollback by hand (UPDATE shop_themes SET draft = b.draft, published = b.published FROM
-- shop_themes_pre_blocks_backup b WHERE b.id = shop_themes.id). Only the themes this migration changes.
CREATE TABLE "shop_themes_pre_blocks_backup" AS
SELECT "id", "shop_id", "theme_id", "draft", "published", now() AS "backed_up_at" FROM "shop_themes" WHERE "theme_id" IN ('ks-bootshop', 'shopco', 'hydrogen', 'storeplate');
--> statement-breakpoint

-- Why a row was left as it was, when it was (see above); null for every row that was converted or had nothing to convert.
ALTER TABLE "shop_themes_pre_blocks_backup" ADD COLUMN "error" text;
--> statement-breakpoint

DO $$
DECLARE
  r record;
  new_draft jsonb;
  new_published jsonb;
BEGIN
  FOR r IN SELECT "id", "draft", "published" FROM "shop_themes" WHERE "theme_id" = 'ks-bootshop' LOOP
    BEGIN
      new_draft := shopnex_theme_announcement_to_block(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(r.draft, 'hero-carousel', 'slide', '{"image": "image_{n}", "heading": "heading_{n}", "text": "text_{n}", "button_label": "button_label_{n}", "button_link": "button_link_{n}"}'::jsonb, 3), 'featured-collections', 'collection', '{"collection": "collection_{n}"}'::jsonb, 4), 'testimonials', 'quote', '{"quote": "quote_{n}", "author": "author_{n}"}'::jsonb, 3), 'faq', 'question', '{"question": "question_{n}", "answer": "answer_{n}"}'::jsonb, 5), 'announcement_text', 'announcement_link', NULL, 'show_announcement');
      new_published := shopnex_theme_announcement_to_block(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(r.published, 'hero-carousel', 'slide', '{"image": "image_{n}", "heading": "heading_{n}", "text": "text_{n}", "button_label": "button_label_{n}", "button_link": "button_link_{n}"}'::jsonb, 3), 'featured-collections', 'collection', '{"collection": "collection_{n}"}'::jsonb, 4), 'testimonials', 'quote', '{"quote": "quote_{n}", "author": "author_{n}"}'::jsonb, 3), 'faq', 'question', '{"question": "question_{n}", "answer": "answer_{n}"}'::jsonb, 5), 'announcement_text', 'announcement_link', NULL, 'show_announcement');
      IF new_draft IS DISTINCT FROM r.draft OR new_published IS DISTINCT FROM r.published THEN
        UPDATE "shop_themes" SET "draft" = new_draft, "published" = new_published WHERE "id" = r.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'shop_themes %: left as it was, not converted: %', r.id, SQLERRM;
      UPDATE "shop_themes_pre_blocks_backup" SET "error" = SQLERRM WHERE "id" = r.id;
    END;
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  r record;
  new_draft jsonb;
  new_published jsonb;
BEGIN
  FOR r IN SELECT "id", "draft", "published" FROM "shop_themes" WHERE "theme_id" = 'shopco' LOOP
    BEGIN
      new_draft := shopnex_theme_announcement_to_block(shopnex_theme_blocks_from_lines(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(r.draft, 'hero', 'stat', '{"value": "stat_{n}_value", "label": "stat_{n}_label"}'::jsonb, 3), 'style-grid', 'collection', '{"collection": "collection_{n}"}'::jsonb, 4), 'testimonials', 'quote', '{"name": "name_{n}", "quote": "quote_{n}"}'::jsonb, 5), 'brands', 'brand', 'names', 'name', 8), 'announcement_text', 'announcement_link', 'announcement_link_label', NULL);
      new_published := shopnex_theme_announcement_to_block(shopnex_theme_blocks_from_lines(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(shopnex_theme_blocks_from_settings(r.published, 'hero', 'stat', '{"value": "stat_{n}_value", "label": "stat_{n}_label"}'::jsonb, 3), 'style-grid', 'collection', '{"collection": "collection_{n}"}'::jsonb, 4), 'testimonials', 'quote', '{"name": "name_{n}", "quote": "quote_{n}"}'::jsonb, 5), 'brands', 'brand', 'names', 'name', 8), 'announcement_text', 'announcement_link', 'announcement_link_label', NULL);
      IF new_draft IS DISTINCT FROM r.draft OR new_published IS DISTINCT FROM r.published THEN
        UPDATE "shop_themes" SET "draft" = new_draft, "published" = new_published WHERE "id" = r.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'shop_themes %: left as it was, not converted: %', r.id, SQLERRM;
      UPDATE "shop_themes_pre_blocks_backup" SET "error" = SQLERRM WHERE "id" = r.id;
    END;
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  r record;
  new_draft jsonb;
  new_published jsonb;
BEGIN
  FOR r IN SELECT "id", "draft", "published" FROM "shop_themes" WHERE "theme_id" = 'hydrogen' LOOP
    BEGIN
      new_draft := shopnex_theme_blocks_from_settings(r.draft, 'collection-list', 'collection', '{"collection": "collection_{n}"}'::jsonb, 6);
      new_published := shopnex_theme_blocks_from_settings(r.published, 'collection-list', 'collection', '{"collection": "collection_{n}"}'::jsonb, 6);
      IF new_draft IS DISTINCT FROM r.draft OR new_published IS DISTINCT FROM r.published THEN
        UPDATE "shop_themes" SET "draft" = new_draft, "published" = new_published WHERE "id" = r.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'shop_themes %: left as it was, not converted: %', r.id, SQLERRM;
      UPDATE "shop_themes_pre_blocks_backup" SET "error" = SQLERRM WHERE "id" = r.id;
    END;
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  r record;
  new_draft jsonb;
  new_published jsonb;
BEGIN
  FOR r IN SELECT "id", "draft", "published" FROM "shop_themes" WHERE "theme_id" = 'storeplate' LOOP
    BEGIN
      new_draft := shopnex_theme_announcement_to_block(r.draft, 'announcement_text', 'announcement_link', NULL, NULL);
      new_published := shopnex_theme_announcement_to_block(r.published, 'announcement_text', 'announcement_link', NULL, NULL);
      IF new_draft IS DISTINCT FROM r.draft OR new_published IS DISTINCT FROM r.published THEN
        UPDATE "shop_themes" SET "draft" = new_draft, "published" = new_published WHERE "id" = r.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'shop_themes %: left as it was, not converted: %', r.id, SQLERRM;
      UPDATE "shop_themes_pre_blocks_backup" SET "error" = SQLERRM WHERE "id" = r.id;
    END;
  END LOOP;
END $$;
