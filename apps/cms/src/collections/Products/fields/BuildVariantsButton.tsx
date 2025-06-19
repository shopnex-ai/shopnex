"use client";

import type { ClientFieldProps } from "payload";

import { Button, toast, useField, useFormFields } from "@payloadcms/ui";
import { reduceFieldsToValues } from "payload/shared";
import React, { useCallback } from "react";

type Option = {
    id: string;
    option: string;
    value: string[];
};

type VariantOption = {
    option: string;
    value: string;
};

type Variant = {
    gallery: string[];
    imageUrl: null | string;
    options: VariantOption[];
    originalPrice: null | number;
    price: null | number;
    vid: null | string;
};

/**
 * Generates all possible variant combinations for given options.
 * Each option is combined with every other option by generating a Cartesian product.
 */
function generateVariantCombinations(options: Option[]): Variant[] {
    // Check if options is undefined or not an array
    if (!Array.isArray(options) || options.length === 0) {
        return [];
    }

    // Validate that each option has required properties and values
    const validOptions = options.filter((option): option is Option => {
        return (
            option &&
            typeof option === "object" &&
            "id" in option &&
            "option" in option &&
            Array.isArray(option.value) &&
            option.value.length > 0
        );
    });

    if (validOptions.length === 0) {
        return [];
    }

    // Generate Cartesian product of options with additional error handling
    try {
        const combinations = validOptions.reduce<VariantOption[][]>(
            (acc, option) => {
                if (!Array.isArray(option.value)) {
                    return acc;
                }
                return acc.flatMap((combo) =>
                    option.value.map((value) => [
                        ...combo,
                        { option: option.option, value },
                    ])
                );
            },
            [[]]
        );

        return combinations.map((combo) => ({
            gallery: [],
            imageUrl: null,
            options: combo,
            originalPrice: null,
            price: 0,
            vid: null,
        }));
    } catch (error) {
        console.error("Error generating variant combinations:", error);
        return [];
    }
}

const VariantGenerator = ({ path }: { path: string } & ClientFieldProps) => {
    const { setValue } = useField({ path });

    const options = useFormFields(([fields]) =>
        Object.entries(fields)
            .filter(([key]) => key.startsWith("variantOptions."))
            .reduce<Record<string, any>>((acc, [key, field]) => {
                acc[key] = field;
                return acc;
            }, {})
    );

    const { variantOptions } = reduceFieldsToValues(options, true) || {};

    const fieldDispatch = useFormFields(([, dispatch]) => dispatch);

    const handleBuildVariants = useCallback(() => {
        try {
            // Ensure variantOptions is an array
            if (!Array.isArray(variantOptions)) {
                toast.error("No variant options found");
                return;
            }

            const variants = generateVariantCombinations(variantOptions);

            if (variants.length === 0) {
                toast.warning("No valid variants could be generated");
                return;
            }

            variants.forEach((variant, index) => {
                fieldDispatch({
                    type: "ADD_ROW",
                    path: "variants",
                    rowIndex: index,
                });

                [
                    { path: `variants.${index}.vid`, value: variant.vid },
                    {
                        path: `variants.${index}.imageUrl`,
                        value: variant.imageUrl,
                    },
                    { path: `variants.${index}.price`, value: variant.price },
                    {
                        path: `variants.${index}.originalPrice`,
                        value: variant.originalPrice,
                    },
                ].forEach(({ path, value }) => {
                    fieldDispatch({ type: "UPDATE", path, value });
                });

                variant.options.forEach((option, optionIndex) => {
                    fieldDispatch({
                        type: "UPDATE",
                        path: `variants.${index}.options.${optionIndex}.option`,
                        value: option.option,
                    });
                    fieldDispatch({
                        type: "UPDATE",
                        path: `variants.${index}.options.${optionIndex}.value`,
                        value: option.value,
                    });
                });
            });

            toast.success("Variants built successfully!");
            setValue("");
        } catch (error) {
            console.error("Error building variants:", error);
            toast.error("Failed to build variants");
        }
    }, [fieldDispatch, variantOptions, setValue]);

    return <Button onClick={handleBuildVariants}>Build Variants</Button>;
};

export default React.memo(VariantGenerator);
