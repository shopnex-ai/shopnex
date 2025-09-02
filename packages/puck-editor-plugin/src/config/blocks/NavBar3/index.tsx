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

export type NavBar3Props = {
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

export const NavBar3: ComponentConfig<NavBar3Props> = {
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
            { name: "Catalog", href: "catalog.html", hasDropdown: true },
            { name: "Brands", href: "brands.html", hasDropdown: true },
            { name: "Pages", href: "#", hasDropdown: true },
            { name: "Blog", href: "blog.html", hasDropdown: false },
            { name: "About", href: "about.html", hasDropdown: false },
            { name: "Contacts", href: "contacts.html", hasDropdown: false },
        ],
        userMenuItems: [
            { name: "Orders", href: "account.html", badge: "2" },
            { name: "Favorites", href: "favorites.html", badge: "3" },
            { name: "Personal", href: "personal.html" },
            { name: "Settings", href: "settings.html" },
            { name: "Log out", href: "#" },
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
            className={`uk-navbar-container tm-navbar-container uk-sticky ${styles.navbarContainer} ${sticky ? styles.navbarContainerFixed : styles.navbarContainerStatic}`}
            {...(sticky && {
                "uk-sticky": "cls-active: tm-navbar-container-fixed",
            })}
        >
            <div className={`${containerClass} uk-navbar ${styles.navbar}`} uk-navbar="">
                {/* Left Side */}
                <div className={`uk-navbar-left ${styles.navbarLeft}`}>
                    {/* Mobile Hamburger */}
                    {showHamburger && (
                        <button
                            className={`uk-navbar-toggle uk-hidden@m uk-navbar-toggle-icon uk-icon ${styles.navbarToggle} ${styles.visibleMobile}`}
                            uk-toggle="target: #nav-offcanvas"
                            uk-navbar-toggle-icon=""
                        >
                            <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                <rect y="9" width="20" height="2"></rect>
                                <rect y="3" width="20" height="2"></rect>
                                <rect y="15" width="20" height="2"></rect>
                            </svg>
                        </button>
                    )}

                    {/* Logo */}
                    <a className={`uk-navbar-item uk-logo ${styles.navbarItem} ${styles.logo}`} href="index.html">
                        <DropZone zone="logo" />
                    </a>

                    {/* Desktop Navigation */}
                    <nav className={`uk-visible@m ${styles.hiddenMobile}`}>
                        <ul className={`uk-navbar-nav ${styles.navbarNav}`}>
                            {navItems?.map((item, index) => (
                                <li key={index}>
                                    <a href={item.href}>
                                        {item.name}
                                        {item.hasDropdown && (
                                            <span className="uk-margin-xsmall-left uk-icon" uk-icon="icon: chevron-down; ratio: .75;">
                                                <svg width="15" height="15" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                                    <polyline fill="none" stroke="#000" strokeWidth="1.03" points="16 7 10 13 4 7"></polyline>
                                                </svg>
                                            </span>
                                        )}
                                    </a>
                                    {item.hasDropdown && (
                                        <div className={`uk-navbar-dropdown uk-margin-remove uk-padding-remove-vertical uk-drop ${styles.navbarDropdown}`} 
                                             uk-drop="pos: bottom-justify;delay-show: 125;delay-hide: 50;duration: 75;boundary: .tm-navbar-container;boundary-align: true;pos: bottom-justify;flip: x">
                                            <DropZone zone={`dropdown-${index}`} />
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
                                className={`uk-navbar-toggle tm-navbar-button uk-search-icon uk-icon ${styles.navbarButton}`}
                                href="#"
                                uk-search-icon=""
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                    <circle fill="none" stroke="#000" strokeWidth="1.1" cx="9" cy="9" r="7"></circle>
                                    <path fill="none" stroke="#000" strokeWidth="1.1" d="M14,14 L18,18 L14,14 Z"></path>
                                </svg>
                            </a>
                            <div
                                className={`uk-navbar-dropdown uk-padding-small uk-margin-remove ${styles.searchDropdown}`}
                                uk-drop="mode: click;cls-drop: uk-navbar-dropdown;boundary: .tm-navbar-container;boundary-align: true;pos: bottom-justify;flip: x"
                            >
                                <div className={containerClass}>
                                    <div
                                        className={`uk-grid-small uk-flex-middle uk-grid uk-grid-stack ${styles.searchForm}`}
                                        uk-grid=""
                                    >
                                        <div className="uk-width-expand">
                                            <form className={`uk-search uk-search-navbar uk-width-1-1 ${styles.searchForm}`}>
                                                <input
                                                    className={`uk-search-input ${styles.searchInput}`}
                                                    type="search"
                                                    placeholder={searchPlaceholder}
                                                    autoFocus
                                                />
                                            </form>
                                        </div>
                                        <div className="uk-width-auto">
                                            <a
                                                className={`uk-navbar-dropdown-close uk-close uk-icon ${styles.closeButton}`}
                                                href="#"
                                                uk-close=""
                                            >
                                                <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
                                                    <line fill="none" stroke="#000" strokeWidth="1.1" x1="1" y1="1" x2="13" y2="13"></line>
                                                    <line fill="none" stroke="#000" strokeWidth="1.1" x1="13" y1="1" x2="1" y2="13"></line>
                                                </svg>
                                            </a>
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
                            href="compare.html"
                        >
                            <span uk-icon="copy" className="uk-icon">
                                <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                    <rect fill="none" stroke="#000" x="3.5" y="2.5" width="12" height="16"></rect>
                                    <polyline fill="none" stroke="#000" points="5 0.5 17.5 0.5 17.5 17"></polyline>
                                </svg>
                            </span>
                            {compareCount && (
                                <span className={`uk-badge ${styles.badge}`}>{compareCount}</span>
                            )}
                        </a>
                    )}

                    {/* User Menu */}
                    {showUser && (
                        <>
                            <a
                                className={`uk-navbar-item uk-link-muted tm-navbar-button uk-icon ${styles.navbarItem} ${styles.navbarButton}`}
                                href="account.html"
                                uk-icon="user"
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                    <circle fill="none" stroke="#000" strokeWidth="1.1" cx="9.9" cy="6.4" r="4.4"></circle>
                                    <path fill="none" stroke="#000" strokeWidth="1.1" d="M1.5,19 C2.3,14.5 5.8,11.2 10,11.2 C14.2,11.2 17.7,14.6 18.5,19.2"></path>
                                </svg>
                            </a>
                            <div
                                className={`uk-padding-small uk-margin-remove uk-dropdown ${styles.userDropdown}`}
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
                                    {userMenuItems && userMenuItems.length > 0 && (
                                        <li className={`uk-nav-divider ${styles.divider}`}></li>
                                    )}
                                </ul>
                            </div>
                        </>
                    )}

                    {/* Cart */}
                    {showCart && (
                        <a
                            className={`uk-navbar-item uk-link-muted tm-navbar-button ${styles.navbarItem} ${styles.navbarButton}`}
                            href="cart.html"
                            uk-toggle="target: #cart-offcanvas"
                            onClick={() => false}
                        >
                            <span uk-icon="cart" className="uk-icon">
                                <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="7.3" cy="17.3" r="1.4"></circle>
                                    <circle cx="13.3" cy="17.3" r="1.4"></circle>
                                    <polyline fill="none" stroke="#000" points="0 2 3.2 4 5.3 12.5 16 12.5 18 6.5 8 6.5"></polyline>
                                </svg>
                            </span>
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