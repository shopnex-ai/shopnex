import { getPayload } from "payload";

import { type WishList } from "@/stores/WishlistStore/types";
import { getCustomer } from "@/utilities/getCustomer";
import config from "@payload-config";

export async function POST(req: Request) {
  try {
    const contentLength = req.headers.get("content-length");
    if (!contentLength || contentLength === "0") {
      return Response.json(JSON.stringify({ error: "Empty request body" }), { status: 400 });
    }

    let wishlist: WishList | undefined;
    try {
      wishlist = (await req.json()) as WishList | undefined;
    } catch {
      return Response.json(JSON.stringify({ error: "Invalid JSON in request body" }), { status: 400 });
    }

    const user = await getCustomer();

    if (!wishlist || !user) {
      return Response.json({ status: 400 });
    }

    const payload = await getPayload({ config });

    console.log(wishlist);

    await payload.update({
      collection: "customers",
      id: user.id,
      data: {
        wishlist: JSON.stringify(wishlist),
      },
    });

    return Response.json({ status: 200, message: "Wishlist saved successfully" });
  } catch (error) {
    console.log(error);
    return new Response(JSON.stringify({ status: 500, message: "Internal server error" }), { status: 500 });
  }
}

export async function GET() {
  try {
    const user = await getCustomer();

    if (!user) {
      return Response.json({ status: 400 });
    }

    return Response.json({
      status: 200,
      data: typeof user.wishlist === "string" ? (JSON.parse(user.wishlist) as WishList) : user.wishlist,
    });
  } catch (error) {
    console.log(error);
    return new Response(JSON.stringify({ status: 500, message: "Internal server error" }), { status: 500 });
  }
}
