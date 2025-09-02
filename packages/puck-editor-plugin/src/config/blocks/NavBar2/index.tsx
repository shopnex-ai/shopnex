import React from "react";
import { ComponentConfig, DropZone } from "@measured/puck";
import styles from "./styles.module.css";

export type NavItem = {
    name: string;
    href: string;
    hasDropdown?: boolean;
};

export type UserMenuItem = {
    name: string;
    href: string;
    badge?: string;
};

export type NavBar2Props = {
    sticky?: boolean;
    containerClass?: string;
    showHamburger?: boolean;
    showSearch?: boolean;
    showCompare?: boolean;
    showUser?: boolean;
    showCart?: boolean;
    compareCount?: number;
    cartCount?: number;
    userMenuItems?: UserMenuItem[];
    navItems?: NavItem[];
    searchPlaceholder?: string;
};

export const NavBar2: ComponentConfig<NavBar2Props> = {
    fields: {
        sticky: {
            type: "radio",
            label: "Sticky Navigation",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        containerClass: {
            type: "text",
            label: "Container CSS Classes",
        },
        showHamburger: {
            type: "radio",
            label: "Show Mobile Menu Button",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        showSearch: {
            type: "radio",
            label: "Show Search",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        showCompare: {
            type: "radio",
            label: "Show Compare",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        showUser: {
            type: "radio",
            label: "Show User Menu",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        showCart: {
            type: "radio",
            label: "Show Cart",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        compareCount: {
            type: "number",
            label: "Compare Badge Count",
        },
        cartCount: {
            type: "number",
            label: "Cart Badge Count",
        },
        searchPlaceholder: {
            type: "text",
            label: "Search Placeholder Text",
        },
        navItems: {
            type: "array",
            label: "Navigation Items",
            arrayFields: {
                name: {
                    type: "text",
                    label: "Item Name",
                },
                href: {
                    type: "text",
                    label: "Link URL",
                },
                hasDropdown: {
                    type: "radio",
                    label: "Has Dropdown",
                    options: [
                        { label: "Yes", value: true },
                        { label: "No", value: false },
                    ],
                },
            },
        },
        userMenuItems: {
            type: "array",
            label: "User Menu Items",
            arrayFields: {
                name: {
                    type: "text",
                    label: "Menu Item Name",
                },
                href: {
                    type: "text",
                    label: "Link URL",
                },
                badge: {
                    type: "text",
                    label: "Badge Text",
                },
            },
        },
    },
    defaultProps: {
        sticky: true,
        containerClass: "uk-container",
        showHamburger: true,
        showSearch: true,
        showCompare: true,
        showUser: true,
        showCart: true,
        compareCount: 3,
        cartCount: 2,
        searchPlaceholder: "Search…",
        navItems: [
            { name: "Home", href: "#", hasDropdown: false },
            { name: "Catalog", href: "#", hasDropdown: true },
            { name: "Brands", href: "#", hasDropdown: true },
            { name: "Pages", href: "#", hasDropdown: true },
        ],
        userMenuItems: [
            { name: "Orders", href: "/account", badge: "2" },
            { name: "Favorites", href: "/favorites", badge: "3" },
            { name: "Personal", href: "/personal" },
            { name: "Settings", href: "/settings" },
            { name: "Log out", href: "/logout" },
        ],
    },
    render: ({
        sticky,
        containerClass,
        showHamburger,
        showSearch,
        showCompare,
        showUser,
        showCart,
        compareCount,
        cartCount,
        searchPlaceholder,
        navItems,
        userMenuItems,
    }) => (
        <div
            className={`uk-navbar-container tm-navbar-container ${styles.navbarContainer} ${sticky ? styles.navbarContainerFixed : styles.navbarContainerStatic}`}
            {...(sticky && {
                "uk-sticky": "cls-active: tm-navbar-container-fixed",
            })}
        >
            <div className={`${containerClass} ${styles.navbar}`} uk-navbar="">
                {/* Left Side */}
                <div className={`uk-navbar-left ${styles.navbarLeft}`}>
                    {/* Mobile Hamburger */}
                    {showHamburger && (
                        <button
                            className={`uk-navbar-toggle uk-hidden@m ${styles.navbarToggle} ${styles.visibleMobile}`}
                            uk-toggle="target: #nav-offcanvas"
                            uk-navbar-toggle-icon=""
                        />
                    )}

                    {/* Logo */}
                    <div className={`uk-navbar-item uk-logo ${styles.navbarItem} ${styles.logo}`}>
                        <DropZone zone="logo" />
                    </div>

                    {/* Desktop Navigation */}
                    <nav className={`uk-visible@m ${styles.hiddenMobile}`}>
                        <ul className={`uk-navbar-nav ${styles.navbarNav}`}>
                            {navItems?.map((item, index) => (
                                <li key={index}>
                                    <a href={item.href}>
                                        {item.name}
                                        {item.hasDropdown && (
                                            <svg
                                                className="uk-margin-small-left"
                                                width="12"
                                                height="12"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                            >
                                                <polyline points="6,9 12,15 18,9" />
                                            </svg>
                                        )}
                                    </a>
                                    {item.hasDropdown && (
                                        <div className={`uk-navbar-dropdown uk-margin-remove uk-padding-remove-vertical ${styles.navbarDropdown}`}>
                                            <DropZone
                                                zone={`dropdown-${index}`}
                                            />
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>

                {/* Right Side */}
                <div className={`uk-navbar-right ${styles.navbarRight}`}>
                    {/* Search */}
                    {showSearch && (
                        <>
                            <a
                                className={`uk-navbar-toggle tm-navbar-button ${styles.navbarButton}`}
                                href="#"
                                uk-search-icon=""
                            >
                                Search
                            </a>
                            <div
                                className={`uk-navbar-dropdown uk-padding-small uk-margin-remove ${styles.searchDropdown}`}
                                uk-drop="mode: click; cls-drop: uk-navbar-dropdown; boundary: .tm-navbar-container; boundary-align: true; pos: bottom-justify; flip: x"
                            >
                                <div className={containerClass}>
                                    <div
                                        className="uk-grid-small uk-flex-middle"
                                        uk-grid=""
                                    >
                                        <div className="uk-width-expand">
                                            <form className={`uk-search uk-search-navbar uk-width-1-1 ${styles.searchForm}`}>
                                                <input
                                                    className={`uk-search-input ${styles.searchInput}`}
                                                    type="search"
                                                    placeholder={
                                                        searchPlaceholder
                                                    }
                                                    autoFocus
                                                />
                                            </form>
                                        </div>
                                        <div className="uk-width-auto">
                                            <a
                                                className={`uk-navbar-dropdown-close ${styles.closeButton}`}
                                                href="#"
                                                uk-close=""
                                            ></a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Compare */}
                    {showCompare && (
                        <a
                            className={`uk-navbar-item uk-link-muted uk-visible@m tm-navbar-button ${styles.navbarItem} ${styles.navbarButton} ${styles.hiddenMobile}`}
                            href="/compare"
                        >
                            <span uk-icon="copy"></span>
                            {compareCount && (
                                <span className={`uk-badge ${styles.badge}`}>{compareCount}</span>
                            )}
                        </a>
                    )}

                    {/* User Menu */}
                    {showUser && (
                        <>
                            <a
                                className={`uk-navbar-item uk-link-muted tm-navbar-button ${styles.navbarItem} ${styles.navbarButton}`}
                                href="/account"
                                uk-icon="user"
                            ></a>
                            <div
                                className={`uk-padding-small uk-margin-remove ${styles.userDropdown}`}
                                uk-dropdown="pos: bottom-right; offset: -10; delay-hide: 200;"
                            >
                                <ul className={`uk-nav uk-dropdown-nav ${styles.userNav}`}>
                                    {userMenuItems?.map((item, index) => (
                                        <li key={index}>
                                            <a href={item.href}>
                                                {item.name}
                                                {item.badge && (
                                                    <span> ({item.badge})</span>
                                                )}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </>
                    )}

                    {/* Cart */}
                    {showCart && (
                        <a
                            className={`uk-navbar-item uk-link-muted tm-navbar-button ${styles.navbarItem} ${styles.navbarButton}`}
                            href="/cart"
                            uk-toggle="target: #cart-offcanvas"
                            onClick={() => false}
                        >
                            <span uk-icon="cart"></span>
                            {cartCount && (
                                <span className={`uk-badge ${styles.badge}`}>{cartCount}</span>
                            )}
                        </a>
                    )}
                </div>
            </div>
        </div>
    ),
};
