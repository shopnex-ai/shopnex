import { getLocale } from "next-intl/server";
import { getPayload } from "payload";
import React from "react";

import { type CardPostData } from "@/components/Card";
import { CollectionArchive } from "@/components/CollectionArchive";
import { Search } from "@/components/search/Component";
import { type Locale } from "@/i18n/config";
import config from "@payload-config";

import PageClient from "./page.client";

import type { Metadata } from "next/types";

type Args = {
  searchParams: Promise<{
    q: string;
  }>;
};
export default async function Page({ searchParams: searchParamsPromise }: Args) {
  const { q: query } = await searchParamsPromise;
  console.log(query);
  const payload = await getPayload({ config });
  const locale = (await getLocale()) as Locale;

  const posts = await payload.find({
    collection: "search",
    depth: 1,
    limit: 12,
    locale,
    select: {
      title: true,
      slug: true,
      categories: true,
      meta: true,
    },
    // pagination: false reduces overhead if you don't need totalDocs
    pagination: false,
    ...(query
      ? {
          where: {
            or: [
              {
                title: {
                  like: query,
                },
              },
              {
                "meta.description": {
                  like: query,
                },
              },
              {
                "meta.title": {
                  like: query,
                },
              },
              {
                slug: {
                  like: query,
                },
              },
            ],
          },
        }
      : {}),
  });

  return (
    <div className="pt-24 pb-24">
      <PageClient />
      <div className="container mb-16">
        <div className="prose dark:prose-invert max-w-none text-center">
          <h1 className="mb-8 lg:mb-16">Search</h1>

          <div className="mx-auto max-w-200">
            <Search />
          </div>
        </div>
      </div>

      {posts.totalDocs > 0 ? (
        <CollectionArchive posts={posts.docs as CardPostData[]} />
      ) : (
        <div className="container">No results found.</div>
      )}
    </div>
  );
}

export function generateMetadata(): Metadata {
  return {
    title: `Payload Ecommerce Template Search`,
  };
}
