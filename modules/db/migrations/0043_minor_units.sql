-- Amounts were always kept in hundredths of the main unit. They are now kept in the currency's smallest unit
-- (yen for JPY, fils for BHD, cents for USD), which is what payment providers and the storefront SDK expect.
-- Only currencies that do not have two decimals change: zero-decimal ones lose two digits (rounded), three- and
-- four-decimal ones gain one and two.
CREATE FUNCTION shopnex_to_minor(amount integer, currency text) RETURNS integer AS $$
  SELECT CASE
    WHEN amount IS NULL THEN NULL
    WHEN currency IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF')
      THEN round(amount / 100.0)::integer
    WHEN currency IN ('BHD','IQD','JOD','KWD','LYD','OMR','TND') THEN amount * 10
    WHEN currency IN ('CLF','UYW') THEN amount * 100
    ELSE amount
  END
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
UPDATE "products" p SET "price_cents" = shopnex_to_minor(p."price_cents", s."currency") FROM "shops" s WHERE s."id" = p."shop_id" AND shopnex_to_minor(p."price_cents", s."currency") IS DISTINCT FROM p."price_cents";--> statement-breakpoint
UPDATE "product_variants" v SET "price_cents" = shopnex_to_minor(v."price_cents", s."currency"), "compare_at_price_cents" = shopnex_to_minor(v."compare_at_price_cents", s."currency") FROM "shops" s WHERE s."id" = v."shop_id" AND s."currency" IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF','BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW');--> statement-breakpoint
UPDATE "discounts" d SET "min_subtotal_cents" = shopnex_to_minor(d."min_subtotal_cents", s."currency"), "value" = CASE WHEN d."type" = 'fixed_amount' THEN shopnex_to_minor(d."value", s."currency") ELSE d."value" END FROM "shops" s WHERE s."id" = d."shop_id" AND s."currency" IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF','BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW');--> statement-breakpoint
UPDATE "shipping_rates" r SET "price_cents" = shopnex_to_minor(r."price_cents", s."currency"), "free_above_cents" = shopnex_to_minor(r."free_above_cents", s."currency") FROM "shops" s WHERE s."id" = r."shop_id" AND s."currency" IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF','BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW');--> statement-breakpoint
UPDATE "order_items" i SET "unit_price_cents" = shopnex_to_minor(i."unit_price_cents", o."currency"), "discount_cents" = shopnex_to_minor(i."discount_cents", o."currency") FROM "orders" o WHERE o."id" = i."order_id" AND o."currency" IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF','BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW');--> statement-breakpoint
UPDATE "order_shipping_lines" l SET "price_cents" = shopnex_to_minor(l."price_cents", o."currency"), "discount_cents" = shopnex_to_minor(l."discount_cents", o."currency") FROM "orders" o WHERE o."id" = l."order_id" AND o."currency" IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF','BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW');--> statement-breakpoint
UPDATE "order_transactions" SET "amount_cents" = shopnex_to_minor("amount_cents", "currency") WHERE "currency" IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF','BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW');--> statement-breakpoint
UPDATE "payment_sessions" SET "amount_cents" = shopnex_to_minor("amount_cents", "currency") WHERE "currency" IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF','BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW');--> statement-breakpoint
UPDATE "orders" SET
  "subtotal_cents" = shopnex_to_minor("subtotal_cents", "currency"),
  "shipping_cents" = shopnex_to_minor("shipping_cents", "currency"),
  "tax_cents" = shopnex_to_minor("tax_cents", "currency"),
  "discount_cents" = shopnex_to_minor("discount_cents", "currency"),
  "total_cents" = shopnex_to_minor("total_cents", "currency"),
  "tax_lines" = COALESCE((SELECT jsonb_agg(jsonb_set(l, '{amountCents}', to_jsonb(shopnex_to_minor((l->>'amountCents')::integer, "orders"."currency")))) FROM jsonb_array_elements("orders"."tax_lines") l), '[]'::jsonb)
WHERE "currency" IN ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF','BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW');--> statement-breakpoint
DROP FUNCTION shopnex_to_minor(integer, text);
