import { ComponentConfig } from "@measured/puck";
import "./styles.scss";

interface ProductInfoProps {
    brand?: {
        name: string;
        logo: string;
        href?: string;
    };
    rating?: {
        stars: number;
        reviewCount: number;
        reviewLink?: string;
    };
    labels?: Array<{
        text: string;
        type: "warning" | "danger" | "success" | "primary";
    }>;
    variants?: {
        colors?: Array<{
            name: string;
            value: string;
            tooltip: string;
        }>;
        storage?: Array<{
            name: string;
            value: string;
        }>;
    };
    pricing?: {
        originalPrice?: number;
        currentPrice: number;
        currency?: string;
    };
    actions?: {
        addToCart?: boolean;
        addToFavorites?: boolean;
        addToCompare?: boolean;
    };
    delivery?: {
        inStock?: boolean;
        deliveryText?: string;
        deliverySubtext?: string;
        pickupText?: string;
        pickupSubtext?: string;
    };
    specifications?: Array<{
        label: string;
        value: string;
    }>;
    showDetailedSpecs?: boolean;
}

const ProductInfoComponent = ({
    brand = {
        name: "Apple",
        logo: "/images/brands/apple.svg",
        href: "#"
    },
    rating = {
        stars: 5,
        reviewCount: 2,
        reviewLink: "#reviews"
    },
    labels = [
        { text: "top selling", type: "warning" },
        { text: "trade-in", type: "danger" }
    ],
    variants = {
        colors: [
            { name: "Space Grey", value: "#aaaeb1", tooltip: "Space Grey" },
            { name: "Silver", value: "#dddfde", tooltip: "Silver" }
        ],
        storage: [
            { name: "256 GB", value: "256gb" },
            { name: "512 GB", value: "512gb" }
        ]
    },
    pricing = {
        originalPrice: 1899,
        currentPrice: 1599,
        currency: "$"
    },
    actions = {
        addToCart: true,
        addToFavorites: true,
        addToCompare: true
    },
    delivery = {
        inStock: true,
        deliveryText: "Delivery",
        deliverySubtext: "In stock, free, tomorrow",
        pickupText: "Pick up from store",
        pickupSubtext: "In stock, free, tomorrow"
    },
    specifications = [
        { label: "Diagonal display", value: "15.4\"" },
        { label: "CPU", value: "Intel® Core™ i7" },
        { label: "RAM", value: "16 GB" },
        { label: "Video Card", value: "AMD Radeon Pro 555" }
    ],
    showDetailedSpecs = true
}: ProductInfoProps) => {
    return (
        <div className="product-info">
            <div className="product-info__content">
                {/* Brand */}
                {brand && (
                    <div className="product-info__brand">
                        <a href={brand.href} title={brand.name}>
                            <img src={brand.logo} alt={brand.name} style={{ height: "40px" }} />
                        </a>
                    </div>
                )}

                {/* Rating and Labels */}
                <div className="product-info__rating-section">
                    <div className="product-info__rating-row">
                        <div className="product-info__rating">
                            <ul className="product-info__stars">
                                {Array.from({ length: 5 }, (_, i) => (
                                    <li key={i}>
                                        <span className={`product-info__star ${i < rating.stars ? 'product-info__star--filled' : ''}`}>
                                            <svg width="20" height="20" viewBox="0 0 20 20">
                                                <polygon fill="none" stroke="currentColor" strokeWidth="1.01" points="10 2 12.63 7.27 18.5 8.12 14.25 12.22 15.25 18 10 15.27 4.75 18 5.75 12.22 1.5 8.12 7.37 7.27" />
                                            </svg>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            {rating.reviewCount > 0 && (
                                <div className="product-info__review-count">
                                    <a href={rating.reviewLink}>({rating.reviewCount})</a>
                                </div>
                            )}
                        </div>
                        <div className="product-info__labels">
                            {labels.map((label, index) => (
                                <span key={index} className={`product-info__label product-info__label--${label.type}`}>
                                    {label.text}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Variants */}
                {variants && (
                    <div className="product-info__variants">
                        <div className="product-info__variants-row">
                            {variants.colors && (
                                <div className="product-info__variant-group">
                                    <div className="product-info__variant-label">Color</div>
                                    <ul className="product-info__color-options">
                                        {variants.colors.map((color, index) => (
                                            <li key={index} className={index === 0 ? "product-info__color-option product-info__color-option--active" : "product-info__color-option"}>
                                                <button className="product-info__color-button" title={color.tooltip}>
                                                    <div style={{ backgroundColor: color.value }}></div>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {variants.storage && (
                                <div className="product-info__variant-group">
                                    <div className="product-info__variant-label">SSD Storage</div>
                                    <ul className="product-info__storage-options">
                                        {variants.storage.map((storage, index) => (
                                            <li key={index} className={index === 0 ? "product-info__storage-option product-info__storage-option--active" : "product-info__storage-option"}>
                                                <button>{storage.name}</button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Pricing and Actions */}
                <div className="product-info__purchase">
                    <div className="product-info__purchase-box">
                        <div className="product-info__pricing">
                            {pricing.originalPrice && (
                                <del className="product-info__original-price">
                                    {pricing.currency}{pricing.originalPrice.toFixed(2)}
                                </del>
                            )}
                            <div className="product-info__current-price">
                                {pricing.currency}{pricing.currentPrice.toFixed(2)}
                            </div>
                        </div>
                        <div className="product-info__actions">
                            <div className="product-info__quantity">
                                <button className="product-info__quantity-btn">
                                    <svg width="15" height="15" viewBox="0 0 20 20">
                                        <rect height="1" width="18" y="9" x="1" />
                                    </svg>
                                </button>
                                <input className="product-info__quantity-input" type="text" maxLength={3} defaultValue="1" />
                                <button className="product-info__quantity-btn">
                                    <svg width="15" height="15" viewBox="0 0 20 20">
                                        <rect x="9" y="1" width="1" height="17" />
                                        <rect x="1" y="9" width="17" height="1" />
                                    </svg>
                                </button>
                            </div>
                            {actions.addToCart && (
                                <button className="product-info__add-to-cart">add to cart</button>
                            )}
                            <div className="product-info__secondary-actions">
                                {actions.addToFavorites && (
                                    <button className="product-info__action-btn" title="Add to favorites">
                                        <svg width="20" height="20" viewBox="0 0 20 20">
                                            <path fill="none" stroke="currentColor" strokeWidth="1.03" d="M10,4 C10,4 8.1,2 5.74,2 C3.38,2 1,3.55 1,6.73 C1,8.84 2.67,10.44 2.67,10.44 L10,18 L17.33,10.44 C17.33,10.44 19,8.84 19,6.73 C19,3.55 16.62,2 14.26,2 C11.9,2 10,4 10,4 L10,4 Z" />
                                        </svg>
                                    </button>
                                )}
                                {actions.addToCompare && (
                                    <button className="product-info__action-btn" title="Add to compare">
                                        <svg width="20" height="20" viewBox="0 0 20 20">
                                            <rect fill="none" stroke="currentColor" x="3.5" y="2.5" width="12" height="16" />
                                            <polyline fill="none" stroke="currentColor" points="5 0.5 17.5 0.5 17.5 17" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Delivery Info */}
                {delivery && (
                    <div className="product-info__delivery">
                        <div className="product-info__delivery-box">
                            <div className="product-info__delivery-option">
                                <svg className="product-info__delivery-icon" width="20" height="20" viewBox="0 0 20 20">
                                    <circle cx="7.3" cy="17.3" r="1.4" />
                                    <circle cx="13.3" cy="17.3" r="1.4" />
                                    <polyline fill="none" stroke="currentColor" points="0 2 3.2 4 5.3 12.5 16 12.5 18 6.5 8 6.5" />
                                </svg>
                                <div>
                                    <div className="product-info__delivery-title">{delivery.deliveryText}</div>
                                    <div className="product-info__delivery-subtitle">{delivery.deliverySubtext}</div>
                                </div>
                            </div>
                            <div className="product-info__delivery-option">
                                <svg className="product-info__delivery-icon" width="20" height="20" viewBox="0 0 20 20">
                                    <path fill="none" stroke="currentColor" strokeWidth="1.01" d="M10,0.5 C6.41,0.5 3.5,3.39 3.5,6.98 C3.5,11.83 10,19 10,19 C10,19 16.5,11.83 16.5,6.98 C16.5,3.39 13.59,0.5 10,0.5 L10,0.5 Z" />
                                    <circle fill="none" stroke="currentColor" cx="10" cy="6.8" r="2.3" />
                                </svg>
                                <div>
                                    <div className="product-info__delivery-title">{delivery.pickupText}</div>
                                    <div className="product-info__delivery-subtitle">{delivery.pickupSubtext}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Specifications */}
                {specifications && specifications.length > 0 && (
                    <div className="product-info__specifications">
                        <ul className="product-info__spec-list">
                            {specifications.map((spec, index) => (
                                <li key={index}>
                                    <span className="product-info__spec-label">{spec.label}: </span>
                                    <span className="product-info__spec-value">{spec.value}</span>
                                </li>
                            ))}
                        </ul>
                        {showDetailedSpecs && (
                            <div className="product-info__detailed-specs">
                                <a className="product-info__specs-link" href="#description">
                                    <span>Detailed specifications</span>
                                    <svg width="15" height="15" viewBox="0 0 20 20">
                                        <polyline fill="none" stroke="currentColor" strokeWidth="1.03" points="16 7 10 13 4 7" />
                                    </svg>
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export const ProductInfo: ComponentConfig<ProductInfoProps> = {
    render: ProductInfoComponent,
    label: "Product Info",
    fields: {
        brand: {
            type: "object",
            objectFields: {
                name: { type: "text" },
                logo: { type: "text" },
                href: { type: "text" }
            }
        },
        rating: {
            type: "object",
            objectFields: {
                stars: { type: "number" },
                reviewCount: { type: "number" },
                reviewLink: { type: "text" }
            }
        },
        labels: {
            type: "array",
            arrayFields: {
                text: { type: "text" },
                type: {
                    type: "select",
                    options: [
                        { label: "Warning", value: "warning" },
                        { label: "Danger", value: "danger" },
                        { label: "Success", value: "success" },
                        { label: "Primary", value: "primary" }
                    ]
                }
            }
        },
        variants: {
            type: "object",
            objectFields: {
                colors: {
                    type: "array",
                    arrayFields: {
                        name: { type: "text" },
                        value: { type: "text" },
                        tooltip: { type: "text" }
                    }
                },
                storage: {
                    type: "array",
                    arrayFields: {
                        name: { type: "text" },
                        value: { type: "text" }
                    }
                }
            }
        },
        pricing: {
            type: "object",
            objectFields: {
                originalPrice: { type: "number" },
                currentPrice: { type: "number" },
                currency: { type: "text" }
            }
        },
        actions: {
            type: "object",
            objectFields: {
                addToCart: { type: "radio", options: [{ label: "Yes", value: true }, { label: "No", value: false }] },
                addToFavorites: { type: "radio", options: [{ label: "Yes", value: true }, { label: "No", value: false }] },
                addToCompare: { type: "radio", options: [{ label: "Yes", value: true }, { label: "No", value: false }] }
            }
        },
        delivery: {
            type: "object",
            objectFields: {
                inStock: { type: "radio", options: [{ label: "Yes", value: true }, { label: "No", value: false }] },
                deliveryText: { type: "text" },
                deliverySubtext: { type: "text" },
                pickupText: { type: "text" },
                pickupSubtext: { type: "text" }
            }
        },
        specifications: {
            type: "array",
            arrayFields: {
                label: { type: "text" },
                value: { type: "text" }
            }
        },
        showDetailedSpecs: {
            type: "radio",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false }
            ]
        }
    },
    defaultProps: {
        brand: {
            name: "Apple",
            logo: "/images/brands/apple.svg",
            href: "#"
        },
        rating: {
            stars: 5,
            reviewCount: 2,
            reviewLink: "#reviews"
        },
        labels: [
            { text: "top selling", type: "warning" },
            { text: "trade-in", type: "danger" }
        ],
        variants: {
            colors: [
                { name: "Space Grey", value: "#aaaeb1", tooltip: "Space Grey" },
                { name: "Silver", value: "#dddfde", tooltip: "Silver" }
            ],
            storage: [
                { name: "256 GB", value: "256gb" },
                { name: "512 GB", value: "512gb" }
            ]
        },
        pricing: {
            originalPrice: 1899,
            currentPrice: 1599,
            currency: "$"
        },
        actions: {
            addToCart: true,
            addToFavorites: true,
            addToCompare: true
        },
        delivery: {
            inStock: true,
            deliveryText: "Delivery",
            deliverySubtext: "In stock, free, tomorrow",
            pickupText: "Pick up from store",
            pickupSubtext: "In stock, free, tomorrow"
        },
        specifications: [
            { label: "Diagonal display", value: "15.4\"" },
            { label: "CPU", value: "Intel® Core™ i7" },
            { label: "RAM", value: "16 GB" },
            { label: "Video Card", value: "AMD Radeon Pro 555" }
        ],
        showDetailedSpecs: true
    }
};