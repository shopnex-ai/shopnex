"use client";
import type { SerializedEditorState } from "@payloadcms/richtext-lexical/lexical";

import builder, {
    Builder,
    BuilderComponent,
    useIsPreviewing,
    withChildren,
} from "@builder.io/react";
import { RichText } from "@payloadcms/richtext-lexical/react";
import DefaultErrorPage from "next/error";
import Link from "next/link";
import { CartProvider, useCart } from "react-use-cart";

import "./reset.css";
import { BillingForm } from "../components/BillingForm";

interface BuilderPageProps {
    content: any;
    data: any;
}

function DeleteItemWrapper({ children, variantId }: any) {
    const { removeItem } = useCart();

    const handleDeleteItem = () => {
        removeItem(variantId);
    };
    return (
        <div
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDeleteItem();
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    handleDeleteItem();
                }
            }}
            role="button"
            tabIndex={0}
        >
            {children}
        </div>
    );
}

const RichTextDescription = ({ data }: { data: SerializedEditorState }) => {
    return <RichText data={data} />;
};

Builder.registerComponent(RichTextDescription, {
    name: "RichTextDescription",
    inputs: [
        {
            name: "data",
            type: "serializedEditorState",
        },
    ],
});

function AddToCartWrapper({
    children,
    imageUrl,
    price,
    productId,
    quantity,
    title,
    variantId,
}: any) {
    const { addItem } = useCart();

    const handleAddItem = () => {
        addItem(
            {
                id: variantId,
                imageUrl,
                price,
                productId,
                title,
                variantId,
            },
            quantity
        );
    };

    return (
        <div
            onClick={handleAddItem}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    handleAddItem();
                }
            }}
            role="button"
            tabIndex={0}
        >
            {children}
        </div>
    );
}

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
    return (
        <BuilderComponent
            content={content}
            data={{
                ...data,
                cartItems: items,
                cartTotal: cartTotal.toFixed(2),
            }}
            model="page"
            renderLink={(props) => (
                <Link {...props} href={props.href || "/"}>
                    {props.children}
                </Link>
            )}
        />
    );
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
