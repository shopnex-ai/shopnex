import { builder } from "@builder.io/sdk";
import { unstable_cache } from "next/cache";

import { RenderBuilderContent } from "./RenderBuilderContent";

interface BuilderPageProps {
    data: any;
    page: string[];
}

const getCachedBuilderPage = (urlPath: string) => {
    return unstable_cache(
        () =>
            builder
                .get("page", {
                    cache: true,
                    prerender: false,
                    userAttributes: {
                        urlPath,
                    },
                })
                .toPromise(),
        ["builder-page", urlPath],
        {
            revalidate: 60,
            tags: ["builder-page", `builder-page:${urlPath}`],
        }
    );
};

export const BuilderPage = async ({ data, page }: BuilderPageProps) => {
    builder.init(process.env.NEXT_PUBLIC_BUILDER_IO_PUBLIC_KEY!);

    const content = await getCachedBuilderPage("/" + (page?.join("/") || ""))();
    return (
        <>
            <>
                <title>{content?.data.title || "ShopNext"}</title>
                <meta
                    content={content?.data.description || ""}
                    name="description"
                />
            </>
            <RenderBuilderContent content={content} data={data} />
        </>
    );
};
