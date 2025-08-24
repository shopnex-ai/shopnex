import { notFound } from "next/navigation";
import { getPayload } from "payload";
import React from "react";

import { CollectionArchive } from "@/components/CollectionArchive";
import { PageRange } from "@/components/PageRange";
import { Pagination } from "@/components/Pagination";
import { type Locale } from "@/i18n/config";
import configPromise from "@payload-config";

import PageClient from "./page.client";

import type { Metadata } from "next/types";

export const revalidate = 600;

type Args = {
  params: Promise<{
    pageNumber: string;
    locale: Locale;
  }>;
};

export default async function Page({ params: paramsPromise }: Args) {
  const { pageNumber, locale } = await paramsPromise;
  const payload = await getPayload({ config: configPromise });

  const sanitizedPageNumber = Number(pageNumber);

  if (!Number.isInteger(sanitizedPageNumber)) notFound();

  const posts = await payload.find({
    collection: "posts",
    depth: 1,
    limit: 12,
    locale,
    page: sanitizedPageNumber,
    overrideAccess: false,
  });

  return (
    <div className="pt-24 pb-24">
      <PageClient />
      <div className="container mb-16">
        <div className="prose dark:prose-invert max-w-none">
          <h1>Posts</h1>
        </div>
      </div>

      <div className="container mb-8">
        <PageRange collection="posts" currentPage={posts.page} limit={12} totalDocs={posts.totalDocs} />
      </div>

      <CollectionArchive posts={posts.docs} />

      <div className="container">
        {posts?.page && posts?.totalPages > 1 && (
          <Pagination page={posts.page} totalPages={posts.totalPages} />
        )}
      </div>
    </div>
  );
}

export async function generateMetadata({ params: paramsPromise }: Args): Promise<Metadata> {
  const { pageNumber } = await paramsPromise;
  return {
    title: `Payload Ecommerce Template Posts Page ${pageNumber || ""}`,
  };
}

export async function generateStaticParams() {
  const payload = await getPayload({ config: configPromise });
  const { totalDocs } = await payload.count({
    collection: "posts",
    overrideAccess: false,
  });

  const totalPages = Math.ceil(totalDocs / 10);

  const pages: { pageNumber: string }[] = [];

  for (let i = 1; i <= totalPages; i++) {
    pages.push({ pageNumber: String(i) });
  }

  return pages;
}
