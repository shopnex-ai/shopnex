"use client";

import { Builder, BuilderComponent, withChildren } from "@builder.io/react";
import Link from "next/link";
import { useMemo } from "react";
import { useCart } from "react-use-cart";

import "./reset.css";
import { AddToCartWrapper } from "../components/AddToCartWrapper";
import { BillingForm } from "../components/BillingForm";
import { DeleteItemWrapper } from "../components/DeleteItemWrapper";
import { RichTextDescription } from "../components/RichTextDescription";

interface BuilderPageProps {
    content: any;
    data: any;
}

Builder.registerComponent(RichTextDescription, {
    name: "RichTextDescription",
    inputs: [
        {
            name: "data",
            type: "serializedEditorState",
        },
    ],
});

const AddToCartWithBuilderChildren = withChildren(AddToCartWrapper);

const DeleteFromCartWrapper = withChildren(DeleteItemWrapper);

const BillingFormWrapper = withChildren(BillingForm);

Builder.registerComponent(AddToCartWithBuilderChildren, {
    name: "AddToCartWrapper",
    canHaveChildren: true,
    inputs: [
        {
            name: "productId",
            type: "number",
        },
        {
            name: "variantId",
            type: "string",
        },
        {
            name: "quantity",
            type: "number",
        },
        {
            name: "imageUrl",
            type: "string",
        },
        {
            name: "price",
            type: "number",
        },
        {
            name: "title",
            type: "string",
        },
    ],
});

Builder.registerComponent(DeleteFromCartWrapper, {
    name: "DeleteFromCartWrapper",
    canHaveChildren: true,
    inputs: [
        {
            name: "variantId",
            type: "string",
        },
    ],
});

Builder.registerComponent(BillingFormWrapper, {
    name: "BillingFormWrapper",
    canHaveChildren: true,
    inputs: [],
});

export function BuilderContentComponent({ content, data }: BuilderPageProps) {
    const { cartTotal = 0, items = [] } = useCart();

    const builderData = useMemo(
        () => ({
            ...data,
            cartItems: items,
            cartTotal: cartTotal.toFixed(2),
        }),
        [data, items, cartTotal]
    );

    return (
        <BuilderComponent
            content={content}
            data={builderData}
            model="page"
            renderLink={(props) => (
                <Link {...props} href={props.href || "/"}>
                    {props.children}
                </Link>
            )}
        />
    );
}
