import { draftMode } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { getPayload } from "payload";
import React, { cache } from "react";

import { RenderBlocks } from "@/blocks/RenderBlocks";
import { PayloadRedirects } from "@/components/PayloadRedirects";
import { RenderHero } from "@/components/heros/RenderHero";
import { type Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";
import { generateMeta } from "@/utilities/generateMeta";
import config from "@payload-config";

import PageClient from "./page.client";

import type { Metadata } from "next";

export async function generateStaticParams() {
  const payload = await getPayload({ config });
  const pages = await payload.find({
    collection: "pages",
    draft: false,
    limit: 1000,
    overrideAccess: false,
    pagination: false,
    select: {
      slug: true,
    },
  });

  const params = routing.locales.flatMap((locale) => {
    return pages.docs
      ?.filter((doc) => doc.slug !== "home")
      .map(({ slug }) => {
        return { locale, slug };
      });
  });

  return params;
}

type Args = {
  params: Promise<{
    locale: Locale;
    slug?: string;
  }>;
};

export default async function Page({ params: paramsPromise }: Args) {
  // const { isEnabled: draft } = await draftMode();
  const { slug = "home", locale } = await paramsPromise;

  const url = `/${locale}/${slug}`;

  const page = await queryPageBySlug({
    slug,
    locale,
  });

  if (!page) {
    return <PayloadRedirects url={url} locale={locale} />;
  }

  setRequestLocale(locale);

  const { hero, layout } = page;

  return (
    <article className="pb-24 pt-16">
      <PageClient />
      {/* Allows redirects for valid pages too */}
      {!page && slug !== "home" && <PayloadRedirects locale={locale} url={url} />}

      {/* {draft && <LivePreviewListener />} */}

      <RenderHero {...hero} />
      <RenderBlocks blocks={layout} />
    </article>
  );
}

export async function generateMetadata({ params: paramsPromise }: Args): Promise<Metadata> {
  const { slug = "home", locale } = await paramsPromise;
  const page = await queryPageBySlug({
    slug,
    locale,
  });

  return generateMeta({ doc: page! });
}

const queryPageBySlug = cache(async ({ slug, locale }: { slug: string; locale: Locale }) => {
  const { isEnabled: draft } = await draftMode();

  const payload = await getPayload({ config });

  try {
    const result = await payload.find({
      collection: "pages",
      draft,
      limit: 1,
      locale,
      pagination: false,
      overrideAccess: draft,
      where: {
        slug: {
          equals: slug,
        },
      },
    });
    return result.docs?.[0] || null;
  } catch (error) {
    // Now instead of global error we will know at least where the error is
    console.log("Main page error: ", error);
    return null;
  }
});
