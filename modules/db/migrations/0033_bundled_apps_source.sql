-- Apps that ship with the install (see BUNDLED_APPS in modules/apps) were stored as 'custom'
UPDATE "apps" SET "source" = 'bundled' WHERE "client_id" IN ('app_stripe', 'app_cj_dropshipping');
