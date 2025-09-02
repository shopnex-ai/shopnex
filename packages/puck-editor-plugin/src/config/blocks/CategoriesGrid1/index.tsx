import React from "react";
import { ComponentConfig } from "@measured/puck";
import styles from "./styles.module.css";

export type Category = {
  id: string;
  name: string;
  image: string;
  alt?: string;
  href: string;
  priceFrom?: string;
};

export type CategoriesGrid1Props = {
  categories: Category[];
  sectionClass?: string;
  containerClass?: string;
  showViewAll?: boolean;
  viewAllText?: string;
  viewAllHref?: string;
  columns?: "3" | "4" | "6";
  gridGap?: "small" | "medium" | "large";
};

export const CategoriesGrid1: ComponentConfig<CategoriesGrid1Props> = {
  fields: {
    categories: {
      type: "array",
      label: "Categories",
      arrayFields: {
        id: {
          type: "text",
          label: "Category ID",
        },
        name: {
          type: "text",
          label: "Category Name",
        },
        image: {
          type: "text",
          label: "Image URL",
        },
        alt: {
          type: "text",
          label: "Alt Text",
        },
        href: {
          type: "text",
          label: "Link URL",
        },
        priceFrom: {
          type: "text",
          label: "Price From (optional)",
        },
      },
    },
    sectionClass: {
      type: "text",
      label: "Section CSS Classes",
    },
    containerClass: {
      type: "text",
      label: "Container CSS Classes",
    },
    showViewAll: {
      type: "radio",
      label: "Show View All Link",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    },
    viewAllText: {
      type: "text",
      label: "View All Text",
    },
    viewAllHref: {
      type: "text",
      label: "View All Link URL",
    },
    columns: {
      type: "select",
      label: "Number of Columns (Desktop)",
      options: [
        { label: "3 Columns", value: "3" },
        { label: "4 Columns", value: "4" },
        { label: "6 Columns", value: "6" },
      ],
    },
    gridGap: {
      type: "select",
      label: "Grid Spacing",
      options: [
        { label: "Small", value: "small" },
        { label: "Medium", value: "medium" },
        { label: "Large", value: "large" },
      ],
    },
  },
  defaultProps: {
    categories: [
      {
        id: "laptops",
        name: "Laptops",
        image: "https://chekromul.github.io/uikit-ecommerce-template/images/catalog/laptops.png",
        alt: "Laptops",
        href: "subcategory.html",
        priceFrom: "from $149",
      },
      {
        id: "smartphones",
        name: "Smartphones",
        image: "https://chekromul.github.io/uikit-ecommerce-template/images/catalog/smartphones.png",
        alt: "Smartphones",
        href: "subcategory.html",
        priceFrom: "from $99",
      },
      {
        id: "tablets",
        name: "Tablets",
        image: "https://chekromul.github.io/uikit-ecommerce-template/images/catalog/tablets.png",
        alt: "Tablets",
        href: "subcategory.html",
        priceFrom: "from $129",
      },
      {
        id: "watches",
        name: "Smart Watches",
        image: "https://chekromul.github.io/uikit-ecommerce-template/images/catalog/watches.png",
        alt: "Smart Watches",
        href: "subcategory.html",
        priceFrom: "from $49",
      },
      {
        id: "consoles",
        name: "Gaming Consoles",
        image: "https://chekromul.github.io/uikit-ecommerce-template/images/catalog/consoles.png",
        alt: "Gaming Consoles",
        href: "subcategory.html",
        priceFrom: "from $399",
      },
      {
        id: "cameras",
        name: "Cameras",
        image: "https://chekromul.github.io/uikit-ecommerce-template/images/catalog/cameras.png",
        alt: "Cameras",
        href: "subcategory.html",
        priceFrom: "from $129",
      },
    ],
    sectionClass: "uk-section uk-section-default uk-section-small",
    containerClass: "uk-container",
    showViewAll: true,
    viewAllText: "see all categories",
    viewAllHref: "catalog.html",
    columns: "6",
    gridGap: "small",
  },
  render: ({
    categories,
    sectionClass,
    containerClass,
    showViewAll,
    viewAllText,
    viewAllHref,
    columns,
    gridGap,
  }) => {
    const getGridClass = () => {
      const baseClass = styles.grid;
      const gapClass = gridGap === "small" ? styles.ukGridSmall : "";
      
      switch (columns) {
        case "3":
          return `${baseClass} ${styles.grid3Columns} ${gapClass}`;
        case "4":
          return `${baseClass} ${styles.grid4Columns} ${gapClass}`;
        case "6":
        default:
          return `${baseClass} ${styles.ukChildWidth16M} ${gapClass}`;
      }
    };

    if (!categories?.length) {
      return (
        <section className={`${sectionClass} ${styles.section}`}>
          <div className={`${containerClass} ${styles.container}`}>
            <div className={styles.emptyState}>
              <div className={styles.emptyStateText}>No categories available</div>
              <div className={styles.emptyStateSubtext}>
                Please add categories to display them here.
              </div>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className={`${sectionClass} ${styles.section}`}>
        <div className={`${containerClass} ${styles.container}`}>
          <div
            className={`uk-grid-small uk-child-width-1-2 uk-child-width-1-3@s uk-child-width-1-${columns}@m uk-grid ${getGridClass()}`}
            uk-grid=""
          >
            {categories.map((category, index) => (
              <div key={category.id} className={index === 0 ? "uk-first-column" : ""}>
                <a
                  className={`uk-link-muted uk-text-center uk-display-block uk-padding-small uk-box-shadow-hover-large ${styles.categoryItem}`}
                  href={category.href}
                >
                  <div className={`tm-ratio tm-ratio-4-3 ${styles.imageWrapper}`}>
                    <div className={`tm-media-box ${styles.mediaBox}`}>
                      <figure className={`tm-media-box-wrap ${styles.mediaBoxWrap}`}>
                        <img
                          className={`item-brand ${styles.categoryImage}`}
                          src={category.image}
                          alt={category.alt || category.name}
                        />
                      </figure>
                    </div>
                  </div>
                  <div className={`uk-margin-small-top ${styles.categoryInfo}`}>
                    <div className={`uk-text-truncate ${styles.categoryName}`}>
                      {category.name}
                    </div>
                    {category.priceFrom && (
                      <div className={`uk-text-meta uk-text-xsmall uk-text-truncate ${styles.categoryPrice}`}>
                        {category.priceFrom}
                      </div>
                    )}
                  </div>
                </a>
              </div>
            ))}
          </div>
          
          {showViewAll && viewAllHref && (
            <div className={`uk-margin uk-text-center ${styles.viewAllContainer}`}>
              <a
                className={`uk-link-muted uk-text-uppercase tm-link-to-all ${styles.viewAllLink}`}
                href={viewAllHref}
              >
                <span>{viewAllText || "see all categories"}</span>
                <span uk-icon="icon: chevron-right; ratio: .75;" className="uk-icon">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                    className={styles.chevronIcon}
                  >
                    <polyline
                      fill="none"
                      stroke="#000"
                      strokeWidth="1.03"
                      points="7 4 13 10 7 16"
                    />
                  </svg>
                </span>
              </a>
            </div>
          )}
        </div>
      </section>
    );
  },
};