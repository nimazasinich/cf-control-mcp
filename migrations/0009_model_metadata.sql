-- Model operator metadata — additive migration for existing v1.8 D1 databases.
-- Model IDs remain immutable; this only adds optional operator-facing
-- display fields. No metadata_json column: no current consumer needs
-- unstructured JSON here, and display_name + description cover the stated
-- requirement without adding an unused, unvalidated free-form field.
ALTER TABLE models ADD COLUMN display_name TEXT;
ALTER TABLE models ADD COLUMN description TEXT;
