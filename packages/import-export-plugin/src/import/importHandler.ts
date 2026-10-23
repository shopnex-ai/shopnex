import type { PayloadHandler } from "payload";

import { parse as parseCookie } from "cookie";
import { unflatten } from "flat";
import { APIError, Forbidden } from "payload";

// Normalize prices if there are variants
function normalizePrices(documents: any[]) {
    return documents.map((doc) => {
        if (Array.isArray(doc.variants)) {
            return {
                ...doc,
                variants: doc.variants.map((variant: any) => ({
                    ...variant,
                    price: Number(variant.price),
                })),
            };
        }
        return doc;
    });
}

// Merge by handle if exists
function mergeByHandle(documents: any[]) {
    const mergedMap = new Map();

    for (const doc of documents) {
        const { handle, variants } = doc;

        if (handle && Array.isArray(variants)) {
            if (mergedMap.has(handle)) {
                const existing = mergedMap.get(handle);
                existing.variants.push(...variants);
            } else {
                mergedMap.set(handle, { ...doc, variants: [...variants] });
            }
        } else {
            // No handle or variants? Just push as-is with a unique key
            mergedMap.set(Symbol(), doc);
        }
    }

    return Array.from(mergedMap.values());
}

// The target collection is fixed by the route the handler is mounted on and
// never taken from the request body.
export const createImportHandler =
    (collectionSlug: string): PayloadHandler =>
    async (req) => {
        if (!req.user) {
            throw new Forbidden(req.t);
        }

        const body = await req.json?.();

        if (!body?.data?.rows || !Array.isArray(body.data.rows)) {
            throw new APIError("Request data with 'rows' is required.");
        }

        const cookieHeader = req.headers.get("cookie") || "";
        const cookies = parseCookie(cookieHeader);

        const shopId = cookies["payload-tenant"];

        if (body.collectionSlug && body.collectionSlug !== collectionSlug) {
            throw new APIError(
                `'collectionSlug' must match the endpoint collection '${collectionSlug}'.`,
                400
            );
        }

        req.payload.logger.info(
            `Import request received for collection: ${collectionSlug} from tenant ${shopId}`
        );

        const user = req.user;

        const documents = body.data.rows.map((row: any) => {
            const normalizedValue: Record<string, any> = {};
            for (const key in row.values) {
                const normalizedKey = key
                    .replace(/\[/g, ".")
                    .replace(/\]/g, "");
                normalizedValue[normalizedKey] = row.values[key];
            }

            const data: any = unflatten(normalizedValue);
            return {
                ...data,
                ...(shopId && { shop: shopId }),
            };
        });

        const normalized = normalizePrices(documents);
        const finalDocuments = mergeByHandle(normalized);

        const createdDocs = await Promise.all(
            finalDocuments.map((doc: any) =>
                req.payload.create({
                    collection: collectionSlug as any,
                    data: doc,
                    overrideAccess: false,
                    user,
                })
            )
        );

        return Response.json({
            data: createdDocs,
            status: 200,
        });
    };
