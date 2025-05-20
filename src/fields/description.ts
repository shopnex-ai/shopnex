import type { Field } from "payload";

import {
    FixedToolbarFeature,
    HeadingFeature,
    HorizontalRuleFeature,
    InlineToolbarFeature,
    lexicalEditor,
} from "@payloadcms/richtext-lexical";

type Description = (fieldToUse?: string, overrides?: Partial<Field>) => Field;

export const description: Description = (
    fieldToUse = "title",
    overrides = {}
) => ({
    name: "description",
    type: "richText",
    editor: lexicalEditor({
        features: ({ rootFeatures }) => {
            return [
                ...rootFeatures,
                HeadingFeature({
                    enabledHeadingSizes: ["h1", "h2", "h3", "h4"],
                }),
                FixedToolbarFeature(),
                InlineToolbarFeature(),
                HorizontalRuleFeature(),
            ];
        },
    }),
    label: false,
});
