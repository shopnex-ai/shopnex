import type { Product } from "@/payload-types";

type ColorOption = {
    colorHex: string;
    label: string;
    value: string;
};

function toKebabCase(str: string): string {
    return str
        .replace(/[^\w\s]/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
}

function mergeColors(color1: string, color2: string): string {
    const hex1 = color1.replace("#", "");
    const hex2 = color2.replace("#", "");

    const r1 = parseInt(hex1.substring(0, 2), 16);
    const g1 = parseInt(hex1.substring(2, 4), 16);
    const b1 = parseInt(hex1.substring(4, 6), 16);

    const r2 = parseInt(hex2.substring(0, 2), 16);
    const g2 = parseInt(hex2.substring(2, 4), 16);
    const b2 = parseInt(hex2.substring(4, 6), 16);

    const r = Math.round((r1 + r2) / 2);
    const g = Math.round((g1 + g2) / 2);
    const b = Math.round((b1 + b2) / 2);

    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function getColorKeyword(value: string): string | undefined {
    const lowerValue = value.toLowerCase();
    const matches = Object.keys(colorHexMap).filter((color) =>
        lowerValue.includes(color)
    );

    if (matches.length >= 2) {
        const color1 = colorHexMap[matches[0]];
        const color2 = colorHexMap[matches[1]];
        return mergeColors(color1, color2);
    }

    return matches[matches.length - 1];
}

const colorHexMap: Record<string, string> = {
    beige: "#F5F5DC",
    black: "#000000",
    blue: "#0000FF",
    brown: "#A52A2A",
    gold: "#FFD700",
    gray: "#808080",
    green: "#008000",
    pink: "#FFC0CB",
    red: "#FF0000",
    silver: "#C0C0C0",
    steel: "#7F8C8D",
    white: "#FFFFFF",
};

export function getColorOptions(variants: Product["variants"]): ColorOption[] {
    const seen = new Set<string>();
    const colorOptions: ColorOption[] = [];

    for (const variant of variants) {
        const colorOption = variant.options?.find(
            (opt) => opt.option === "Color"
        );
        if (colorOption && !seen.has(colorOption.value)) {
            seen.add(colorOption.value);

            const colorMatches = getColorKeyword(colorOption.value);
            const colorHex =
                typeof colorMatches === "string" && colorMatches.startsWith("#")
                    ? colorMatches
                    : colorMatches
                      ? colorHexMap[colorMatches]
                      : "#CCCCCC";

            colorOptions.push({
                colorHex,
                label: toKebabCase(colorOption.value),
                value: colorOption.value,
            });
        }
    }

    return colorOptions;
}
