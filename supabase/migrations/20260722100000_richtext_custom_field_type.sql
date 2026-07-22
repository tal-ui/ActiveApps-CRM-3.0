-- Allow the new 'richtext' custom field type (stored in value_text as
-- sanitized HTML; sanitization happens app-side on save and render).
ALTER TABLE public.custom_fields
  DROP CONSTRAINT IF EXISTS custom_fields_field_type_check;

ALTER TABLE public.custom_fields
  ADD CONSTRAINT custom_fields_field_type_check CHECK (
    (field_type)::text = ANY (
      (ARRAY[
        'text', 'textarea', 'richtext', 'number', 'integer', 'currency',
        'picklist', 'multi_picklist', 'date', 'datetime', 'boolean',
        'relationship', 'url', 'email', 'phone'
      ]::character varying[])::text[]
    )
  );
