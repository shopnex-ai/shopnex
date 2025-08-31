import { BeforeChangeHook } from "@/admin/types";

export const updateInventoryStatus: BeforeChangeHook = ({ data }) => {
    if (data?.variants && Array.isArray(data.variants)) {
        data.variants = data.variants.map((variant: any) => {
            if (
                variant.trackInventory &&
                typeof variant.stockCount === "number"
            ) {
                const stockCount = variant.stockCount;
                const lowStockThreshold = variant.lowStockThreshold || 5;

                if (stockCount <= 0) {
                    variant.inventoryStatus = "out_of_stock";
                } else if (stockCount <= lowStockThreshold) {
                    variant.inventoryStatus = "low_stock";
                } else {
                    variant.inventoryStatus = "in_stock";
                }
            } else if (!variant.trackInventory) {
                variant.inventoryStatus = "in_stock";
            }

            return variant;
        });
    }

    return data;
};
