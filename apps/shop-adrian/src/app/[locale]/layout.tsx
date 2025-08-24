// eslint-disable-next-line
import { GeistMono } from "geist/font/mono";
// eslint-disable-next-line
import { GeistSans } from "geist/font/sans";
// import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import {
    type ReactNode,
    unstable_ViewTransition as ViewTransition,
} from "react";

import "../globals.css";
// import { LivePreviewListener } from "@/components/LivePreviewListener";
import { Footer } from "@/globals/Footer/Component";
import { type Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";
import { Providers } from "@/providers";
import { getServerSideURL } from "@/utilities/getURL";
import { mergeOpenGraph } from "@/utilities/mergeOpenGraph";
import { cn } from "src/utilities/cn";

import type { Metadata } from "next";

export function generateStaticParams() {
    return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
    params,
    children,
}: {
    params: Promise<{ locale: string }>;
    children: ReactNode;
}) {
    // const { isEnabled } = await draftMode();
    const { locale } = await params;

    if (!routing.locales.includes(locale as Locale)) {
        notFound();
    }

    setRequestLocale(locale);

    const messages = await getMessages({ locale });

    return (
        <html
            className={cn(
                GeistSans.variable,
                GeistMono.variable,
                "twp overflow-x-clip lg:overflow-y-scroll"
            )}
            lang={locale}
            // data-thmee="light"
            // suppressHydrationWarning
        >
            <head>
                {/* <InitTheme /> */}
                <link href="/favicon.ico" rel="icon" sizes="32x32" />
                <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
            </head>
            <body className="max-w-screen overflow-x-clip">
                <ViewTransition>
                    <Providers>
                        <NextIntlClientProvider
                            locale={locale}
                            messages={messages}
                        >
                            {/* <AdminBar
              adminBarProps={{
                preview: isEnabled,
              }}
            /> */}
                            {/* {isEnabled && <LivePreviewListener />} */}
                            {children}
                            <Footer />
                        </NextIntlClientProvider>
                    </Providers>
                </ViewTransition>
            </body>
        </html>
    );
}

export const metadata: Metadata = {
    metadataBase: new URL(getServerSideURL()),
    openGraph: mergeOpenGraph(),
    twitter: {
        card: "summary_large_image",
        creator: "@payloadcms",
    },
    robots: {
        index: !(process.env.NEXT_PUBLIC_ROBOTS_INDEX === "false"),
        follow: !(process.env.NEXT_PUBLIC_ROBOTS_INDEX === "false"),
    },
};
