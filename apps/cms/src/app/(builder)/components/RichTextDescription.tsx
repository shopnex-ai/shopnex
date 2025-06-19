"use client";

import type { SerializedEditorState } from "@payloadcms/richtext-lexical/lexical";

import { RichText } from "@payloadcms/richtext-lexical/react";

export const RichTextDescription = ({
    data,
}: {
    data: SerializedEditorState;
}) => {
    return <RichText data={data} />;
};
