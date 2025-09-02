import React from "react";
import { ComponentConfig } from "@measured/puck";
import styles from "./styles.module.scss";

export type TrendingItem = {
    id: string;
    name: string;
    originalPrice?: string;
    currentPrice: string;
    image: string;
    url: string;
    category: string;
    badge?: {
        text: string;
        type: "new" | "top-selling" | "trade-in";
    };
};

export type TrendingItemsProps = {
    title: string;
    items: TrendingItem[];
    columnsPerRow: number;
    showWishlist: boolean;
    showCompare: boolean;
    showCartIcon: boolean;
    backgroundColor: string;
};

export const TrendingItems: ComponentConfig<TrendingItemsProps> = {
    label: "Trending Items",
    fields: {
        title: {
            type: "text",
            label: "Section Title",
            contentEditable: true,
        },
        items: {
            type: "array",
            label: "Trending Items",
            arrayFields: {
                id: {
                    type: "text",
                    label: "Item ID",
                },
                name: {
                    type: "text",
                    label: "Product Name",
                },
                originalPrice: {
                    type: "text",
                    label: "Original Price (optional)",
                },
                currentPrice: {
                    type: "text",
                    label: "Current Price",
                },
                image: {
                    type: "text",
                    label: "Product Image URL",
                },
                url: {
                    type: "text",
                    label: "Product URL",
                },
                category: {
                    type: "text",
                    label: "Category",
                },
                badge: {
                    type: "object",
                    label: "Badge (optional)",
                    objectFields: {
                        text: {
                            type: "text",
                            label: "Badge Text",
                        },
                        type: {
                            type: "select",
                            label: "Badge Type",
                            options: [
                                { label: "New", value: "new" },
                                { label: "Top Selling", value: "top-selling" },
                                { label: "Trade In", value: "trade-in" },
                            ],
                        },
                    },
                },
            },
        },
        columnsPerRow: {
            type: "select",
            label: "Columns per Row",
            options: [
                { label: "2", value: 2 },
                { label: "3", value: 3 },
                { label: "4", value: 4 },
            ],
        },
        showWishlist: {
            type: "radio",
            label: "Show Wishlist Button",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        showCompare: {
            type: "radio",
            label: "Show Compare Button",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        showCartIcon: {
            type: "radio",
            label: "Show Cart Icon",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        backgroundColor: {
            type: "text",
            label: "Background Color",
        },
    },
    defaultProps: {
        title: "Trending Items",
        items: [
            {
                id: "1",
                name: "Apple MacBook Pro 15\" Touch Bar MPTU2LL/A 256GB",
                originalPrice: "$1899.00",
                currentPrice: "$1599.00",
                image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
                url: "/product/macbook-pro-15",
                category: "Laptop",
                badge: {
                    text: "TOP SELLING",
                    type: "top-selling",
                },
            },
            {
                id: "2",
                name: "Apple MacBook 12\" MNYN2LL/A 512GB",
                currentPrice: "$1549.00",
                image: "https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
                url: "/product/macbook-12",
                category: "Laptop",
                badge: {
                    text: "NEW",
                    type: "new",
                },
            },
            {
                id: "3",
                name: "Lenovo IdeaPad YOGA 920-13IKB 80Y7001RRK",
                originalPrice: "$1299.00",
                currentPrice: "$1199.00",
                image: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
                url: "/product/lenovo-yoga-920",
                category: "Laptop",
            },
            {
                id: "4",
                name: "ASUS Zenbook UX330UA-FC020T",
                currentPrice: "$749.00",
                image: "https://images.unsplash.com/photo-1541807084-5c52b6b3adef?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
                url: "/product/asus-zenbook",
                category: "Laptop",
                badge: {
                    text: "TOP SELLING",
                    type: "top-selling",
                },
            },
        ],
        columnsPerRow: 4,
        showWishlist: true,
        showCompare: true,
        showCartIcon: true,
        backgroundColor: "#ffffff",
    },
    render: ({ title, items, columnsPerRow, showWishlist, showCompare, showCartIcon, backgroundColor, puck }) => {
        const getColumnClass = (columns: number) => {
            const colMap = {
                2: styles.col6,
                3: styles.col4,
                4: styles.col3,
            };
            return colMap[columns as keyof typeof colMap] || styles.col3;
        };

        const getBadgeClass = (type: string) => {
            return `${styles.badge} ${styles[`badge${type.charAt(0).toUpperCase() + type.slice(1).replace('-', '')}`]}`;
        };

        return (
            <section 
                className={styles.trendingItems}
                style={{ backgroundColor }}
            >
                <div className={styles.container}>
                    <div className={styles.row}>
                        <div className={styles.col12}>
                            <div className={styles.sectionHeading}>
                                <h2>{title}</h2>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.container}>
                    <div className={styles.row}>
                        {items && items.length > 0 && items.map((item, index) => (
                            <div key={item.id || index} className={getColumnClass(columnsPerRow)}>
                                <article className={styles.trendingItem}>
                                    <div className={styles.itemImage}>
                                        <a 
                                            href={puck?.isEditing ? "#" : item.url}
                                            tabIndex={puck?.isEditing ? -1 : undefined}
                                        >
                                            <img 
                                                src={item.image}
                                                loading="lazy"
                                                alt={item.name}
                                            />
                                        </a>

                                        {item.badge && (
                                            <div className={getBadgeClass(item.badge.type)}>
                                                {item.badge.text}
                                            </div>
                                        )}

                                        <div className={styles.itemActions}>
                                            {showWishlist && (
                                                <button 
                                                    className={styles.actionBtn}
                                                    aria-label="Add to wishlist"
                                                    disabled={puck?.isEditing}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                                                    </svg>
                                                </button>
                                            )}
                                            
                                            {showCompare && (
                                                <button 
                                                    className={styles.actionBtn}
                                                    aria-label="Add to compare"
                                                    disabled={puck?.isEditing}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                        <path d="M9 6l6 6l-6 6"></path>
                                                        <path d="M20 4v16"></path>
                                                        <path d="M4 7v10"></path>
                                                    </svg>
                                                </button>
                                            )}

                                            {showCartIcon && (
                                                <button 
                                                    className={`${styles.actionBtn} ${styles.cartBtn}`}
                                                    aria-label="Add to cart"
                                                    disabled={puck?.isEditing}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                        <circle cx="8" cy="21" r="1"></circle>
                                                        <circle cx="19" cy="21" r="1"></circle>
                                                        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className={styles.itemContent}>
                                        <div className={styles.category}>{item.category}</div>
                                        <a 
                                            href={puck?.isEditing ? "#" : item.url}
                                            tabIndex={puck?.isEditing ? -1 : undefined}
                                            className={styles.itemName}
                                        >
                                            {item.name}
                                        </a>

                                        <div className={styles.priceWrapper}>
                                            {item.originalPrice && (
                                                <span className={styles.originalPrice}>
                                                    {item.originalPrice}
                                                </span>
                                            )}
                                            <span className={styles.currentPrice}>
                                                {item.currentPrice}
                                            </span>
                                        </div>
                                    </div>
                                </article>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        );
    },
};