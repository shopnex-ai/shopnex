import { builder } from "@builder.io/sdk";
import Head from "next/head";
import React from "react";

import { RenderBuilderContent } from "../components/RenderBuilderContent";

interface PageProps {
    params: Promise<{
        page: string[];
    }>;
}

export default async function Page({ params }: PageProps) {
    builder.init(process.env.NEXT_PUBLIC_BUILDER_IO_PUBLIC_KEY!);

    const { page } = await params;
    const data = {};

    const content = await builder
        .get("page", {
            cache: true,
            prerender: false,
            userAttributes: {
                urlPath: "/" + (page?.join("/") || ""),
            },
        })
        .toPromise();

    return (
        <>
            <Head>
                <title>{content?.data.title || "ShopNext"}</title>
                <meta
                    content={content?.data.description || ""}
                    name="description"
                />
            </Head>
            <RenderBuilderContent content={content} data={data} />
        </>
    );
}
