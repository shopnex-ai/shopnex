"use client";

import builder, { useIsPreviewing } from "@builder.io/react";
import DefaultErrorPage from "next/error";
import { CartProvider } from "react-use-cart";

import { BuilderContentComponent } from "../lib/RenderBuilderContent";

interface BuilderPageProps {
    content: any;
    data: any;
}

export function RenderBuilderContent({ content, data }: BuilderPageProps) {
    builder.init(process.env.NEXT_PUBLIC_BUILDER_IO_PUBLIC_KEY!);
    const isPreviewing = useIsPreviewing();

    if (content || isPreviewing) {
        return (
            <CartProvider>
                <BuilderContentComponent content={content} data={data} />
            </CartProvider>
        );
    }

    return <DefaultErrorPage statusCode={404} />;
}
