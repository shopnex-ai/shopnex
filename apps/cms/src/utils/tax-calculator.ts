import type { Payload } from "payload";

interface Address {
    country: string;
    state?: string;
    city?: string;
    zipCode?: string;
}

interface CartItem {
    product: any;
    quantity: number;
    price: number;
}

interface TaxCalculationResult {
    totalTax: number;
    taxBreakdown: Array<{
        ruleName: string;
        rate: number;
        amount: number;
        type: string;
    }>;
    subtotal: number;
    total: number;
}

export class TaxCalculator {
    private payload: Payload;

    constructor(payload: Payload) {
        this.payload = payload;
    }

    async calculateTax(
        cartItems: CartItem[],
        shippingAddress: Address,
        shippingCost = 0
    ): Promise<TaxCalculationResult> {
        // Get applicable tax rules
        const taxRules = await this.getApplicableTaxRules(shippingAddress);
        
        let totalTax = 0;
        const taxBreakdown: TaxCalculationResult['taxBreakdown'] = [];
        
        // Calculate subtotal
        const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // Sort tax rules by priority (lower number = higher priority)
        const sortedRules = taxRules.sort((a, b) => (a.priority || 1) - (b.priority || 1));
        
        for (const rule of sortedRules) {
            if (!rule.active) continue;
            
            // Calculate taxable amount for this rule
            let taxableAmount = this.getTaxableAmount(cartItems, rule, subtotal);
            
            // Add shipping to taxable amount if rule includes shipping
            if (rule.includeShipping) {
                taxableAmount += shippingCost;
            }
            
            if (taxableAmount > 0) {
                let taxAmount = (taxableAmount * rule.rate) / 100;
                
                // Handle compound tax
                if (rule.compoundTax && totalTax > 0) {
                    taxAmount = ((taxableAmount + totalTax) * rule.rate) / 100;
                }
                
                totalTax += taxAmount;
                
                taxBreakdown.push({
                    ruleName: rule.name,
                    rate: rule.rate,
                    amount: taxAmount,
                    type: rule.taxType,
                });
            }
        }
        
        return {
            totalTax: Math.round(totalTax * 100) / 100, // Round to 2 decimal places
            taxBreakdown,
            subtotal,
            total: subtotal + totalTax + shippingCost,
        };
    }

    private async getApplicableTaxRules(address: Address) {
        const whereConditions: any = {
            active: { equals: true },
            'region.country': { equals: address.country },
        };

        // Add state condition if provided
        if (address.state) {
            whereConditions['region.state'] = { equals: address.state };
        }

        // Add city condition if provided
        if (address.city) {
            whereConditions['region.city'] = { equals: address.city };
        }

        // Add ZIP code condition if provided
        if (address.zipCode) {
            whereConditions['region.zipCode'] = { equals: address.zipCode };
        }

        const result = await this.payload.find({
            collection: "tax-rules",
            where: whereConditions,
            limit: 100, // Adjust as needed
        });

        return result.docs;
    }

    private getTaxableAmount(cartItems: CartItem[], rule: any, subtotal: number): number {
        // If no specific products or collections are specified, tax everything
        if (
            (!rule.applicableProducts || rule.applicableProducts.length === 0) &&
            (!rule.applicableCollections || rule.applicableCollections.length === 0)
        ) {
            // Check for exempt products
            if (rule.exemptProducts && rule.exemptProducts.length > 0) {
                const exemptProductIds = rule.exemptProducts.map((p: any) => 
                    typeof p === 'string' ? p : p.id
                );
                
                return cartItems.reduce((sum, item) => {
                    const productId = typeof item.product === 'string' ? item.product : item.product.id;
                    if (!exemptProductIds.includes(productId)) {
                        return sum + (item.price * item.quantity);
                    }
                    return sum;
                }, 0);
            }
            
            return subtotal;
        }

        let taxableAmount = 0;

        // Check applicable products
        if (rule.applicableProducts && rule.applicableProducts.length > 0) {
            const applicableProductIds = rule.applicableProducts.map((p: any) => 
                typeof p === 'string' ? p : p.id
            );
            
            taxableAmount += cartItems.reduce((sum, item) => {
                const productId = typeof item.product === 'string' ? item.product : item.product.id;
                if (applicableProductIds.includes(productId)) {
                    return sum + (item.price * item.quantity);
                }
                return sum;
            }, 0);
        }

        // Check applicable collections
        if (rule.applicableCollections && rule.applicableCollections.length > 0) {
            const applicableCollectionIds = rule.applicableCollections.map((c: any) => 
                typeof c === 'string' ? c : c.id
            );
            
            taxableAmount += cartItems.reduce((sum, item) => {
                const product = typeof item.product === 'string' ? null : item.product;
                if (product && product.collections) {
                    const productCollections = product.collections.map((c: any) => 
                        typeof c === 'string' ? c : c.id
                    );
                    
                    const hasApplicableCollection = productCollections.some((pc: string) => 
                        applicableCollectionIds.includes(pc)
                    );
                    
                    if (hasApplicableCollection) {
                        return sum + (item.price * item.quantity);
                    }
                }
                return sum;
            }, 0);
        }

        return taxableAmount;
    }

    async getTaxRulesForRegion(address: Address) {
        return this.getApplicableTaxRules(address);
    }
}