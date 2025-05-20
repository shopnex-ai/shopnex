import type { FieldHook } from "payload";

import slugify from "slugify";

export const formatSlug =
    (fallback: string): FieldHook =>
    ({ data, operation, originalDoc, value }) => {
        if (typeof value === "string") {
            return slugify(value, { lower: true, strict: true }); // Use slugify for the value
        }

        if (operation === "create") {
            const fallbackData = data?.[fallback] || originalDoc?.[fallback];

            if (fallbackData && typeof fallbackData === "string") {
                return slugify(fallbackData, { lower: true, strict: true }); // Use slugify for the fallback data
            }
        }

        return value;
    };
