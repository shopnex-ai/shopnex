import { builder } from "@builder.io/sdk";
import Head from "next/head";

import { RenderBuilderContent } from "./RenderBuilderContent";

interface BuilderPageProps {
    data: any;
    page: string[];
}

export const BuilderPage = async ({ data, page }: BuilderPageProps) => {
    builder.init(process.env.NEXT_PUBLIC_BUILDER_IO_PUBLIC_KEY!);

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
};
