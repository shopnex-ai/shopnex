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
    if (options.length === 0) {
        return [];
    }

    // Generate Cartesian product of options.
    const combinations = options.reduce<VariantOption[][]>(
        (acc, option) =>
            acc.flatMap((combo) =>
                option.value.map((value) => [
                    ...combo,
                    { option: option.option, value },
                ])
            ),
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

    const { variantOptions } = reduceFieldsToValues(options, true);

    const fieldDispatch = useFormFields(([, dispatch]) => dispatch);

    const handleBuildVariants = useCallback(() => {
        // Shift generation logic here so that variantOptions is freshly read
        // If variantOptions is undefined or empty, it safely returns an empty array.
        const variants = generateVariantCombinations(variantOptions || []);

        variants.forEach((variant, index) => {
            fieldDispatch({
                type: "ADD_ROW",
                path: "variants",
                rowIndex: index,
            });

            [
                { path: `variants.${index}.vid`, value: variant.vid },
                { path: `variants.${index}.imageUrl`, value: variant.imageUrl },
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
        // Call setValue once after variants have been built if needed.
        setValue("");
    }, [fieldDispatch, variantOptions, setValue]);

    return <Button onClick={handleBuildVariants}>Build Variants</Button>;
};

export default React.memo(VariantGenerator);
