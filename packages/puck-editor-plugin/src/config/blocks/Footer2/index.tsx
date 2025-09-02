import { ComponentConfig } from "@measured/puck";
import "./styles.scss";

interface Footer2Props {
    logo?: {
        src: string;
        alt: string;
        width?: number;
        height?: number;
        href?: string;
    };
    description?: string;
    socialLinks?: Array<{
        platform: string;
        href: string;
        icon: string;
    }>;
    navigationSections?: Array<{
        title: string;
        links: Array<{
            text: string;
            href: string;
        }>;
    }>;
    contact?: {
        phone?: string;
        email?: string;
        address?: string;
        hours?: string;
    };
    newsletter?: {
        title?: string;
        placeholder?: string;
    };
    copyright?: string;
}

const Footer2Component = ({
    logo = {
        src: "/images/logo-inverse.svg",
        alt: "Logo",
        width: 90,
        height: 32,
        href: "/",
    },
    description = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed ut mauris eros. Nulla quis ante sed tortor efficitur facilisis.",
    socialLinks = [
        { platform: "Facebook", href: "#", icon: "facebook" },
        { platform: "Twitter", href: "#", icon: "twitter" },
        { platform: "YouTube", href: "#", icon: "youtube" },
        { platform: "Instagram", href: "#", icon: "instagram" },
    ],
    navigationSections = [
        {
            title: "Main",
            links: [
                { text: "Catalog", href: "/catalog" },
                { text: "Brands", href: "/brands" },
                { text: "Delivery", href: "/delivery" },
                { text: "FAQ", href: "/faq" },
                { text: "Payment", href: "/payment" },
            ],
        },
        {
            title: "Company",
            links: [
                { text: "About", href: "/about" },
                { text: "Contacts", href: "/contacts" },
                { text: "Blog", href: "/blog" },
                { text: "News", href: "/news" },
            ],
        },
    ],
    contact = {
        phone: "8 800 799 99 99",
        email: "example@example.com",
        address: "St. Petersburg, Nevsky Prospect 28",
        hours: "Daily 10:00–22:00",
    },
    newsletter = {
        title: "Subscribe for updates",
        placeholder: "Your email",
    },
    copyright = "Shopping Categories icons by Jaro Sigrist from Noun Project",
}: Footer2Props) => {
    return (
        <section className="footer2">
            <div className="footer2__container">
                <div className="footer2__grid">
                    <div className="footer2__brand">
                        <a className="footer2__logo" href={logo.href}>
                            <img
                                src={logo.src}
                                width={logo.width}
                                height={logo.height}
                                alt={logo.alt}
                            />
                        </a>
                        <p className="footer2__description">{description}</p>
                        <ul className="footer2__social">
                            {socialLinks.map((social, index) => (
                                <li key={index}>
                                    <a
                                        href={social.href}
                                        title={social.platform}
                                        className="footer2__social-link"
                                    >
                                        <span
                                            className="footer2__social-icon"
                                            data-icon={social.icon}
                                        >
                                            {social.platform.charAt(0)}
                                        </span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="footer2__navigation">
                        <nav className="footer2__nav-grid">
                            {navigationSections.map((section, sectionIndex) => (
                                <div
                                    key={sectionIndex}
                                    className="footer2__nav-section"
                                >
                                    <h4 className="footer2__nav-title">
                                        {section.title}
                                    </h4>
                                    <ul className="footer2__nav-list">
                                        {section.links.map(
                                            (link, linkIndex) => (
                                                <li key={linkIndex}>
                                                    <a
                                                        href={link.href}
                                                        className="footer2__nav-link"
                                                    >
                                                        {link.text}
                                                    </a>
                                                </li>
                                            )
                                        )}
                                    </ul>
                                </div>
                            ))}
                        </nav>
                    </div>

                    <div className="footer2__contact">
                        <ul className="footer2__contact-list">
                            {contact.phone && (
                                <li>
                                    <a
                                        className="footer2__contact-link"
                                        href={`tel:${contact.phone}`}
                                    >
                                        <span
                                            className="footer2__contact-icon"
                                            data-icon="phone"
                                        >
                                            📞
                                        </span>
                                        <span>{contact.phone}</span>
                                    </a>
                                </li>
                            )}
                            {contact.email && (
                                <li>
                                    <a
                                        className="footer2__contact-link"
                                        href={`mailto:${contact.email}`}
                                    >
                                        <span
                                            className="footer2__contact-icon"
                                            data-icon="email"
                                        >
                                            ✉️
                                        </span>
                                        <span>{contact.email}</span>
                                    </a>
                                </li>
                            )}
                            {contact.address && (
                                <li>
                                    <div className="footer2__contact-info">
                                        <span
                                            className="footer2__contact-icon"
                                            data-icon="location"
                                        >
                                            📍
                                        </span>
                                        <span>{contact.address}</span>
                                    </div>
                                </li>
                            )}
                            {contact.hours && (
                                <li>
                                    <div className="footer2__contact-info">
                                        <span
                                            className="footer2__contact-icon"
                                            data-icon="clock"
                                        >
                                            🕒
                                        </span>
                                        <span>{contact.hours}</span>
                                    </div>
                                </li>
                            )}
                        </ul>
                    </div>

                    <div className="footer2__newsletter">
                        <form className="footer2__form">
                            <label className="footer2__form-label">
                                <div className="footer2__form-title">
                                    {newsletter.title}
                                </div>
                                <div className="footer2__form-input-wrapper">
                                    <input
                                        className="footer2__form-input"
                                        type="email"
                                        placeholder={newsletter.placeholder}
                                        required
                                    />
                                    <button
                                        type="submit"
                                        className="footer2__form-submit"
                                    >
                                        <span data-icon="mail">✉️</span>
                                    </button>
                                </div>
                            </label>
                        </form>
                        {copyright && (
                            <div className="footer2__copyright">
                                {copyright}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

export const Footer2: ComponentConfig<Footer2Props> = {
    render: Footer2Component,
    label: "Footer 2",
    fields: {
        logo: {
            type: "object",
            objectFields: {
                src: { type: "text" },
                alt: { type: "text" },
                width: { type: "number" },
                height: { type: "number" },
                href: { type: "text" },
            },
        },
        description: {
            type: "textarea",
        },
        socialLinks: {
            type: "array",
            arrayFields: {
                platform: { type: "text" },
                href: { type: "text" },
                icon: { type: "text" },
            },
        },
        navigationSections: {
            type: "array",
            arrayFields: {
                title: { type: "text" },
                links: {
                    type: "array",
                    arrayFields: {
                        text: { type: "text" },
                        href: { type: "text" },
                    },
                },
            },
        },
        contact: {
            type: "object",
            objectFields: {
                phone: { type: "text" },
                email: { type: "text" },
                address: { type: "text" },
                hours: { type: "text" },
            },
        },
        newsletter: {
            type: "object",
            objectFields: {
                title: { type: "text" },
                placeholder: { type: "text" },
            },
        },
        copyright: {
            type: "text",
        },
    },
    defaultProps: {
        logo: {
            src: "/images/logo-inverse.svg",
            alt: "Logo",
            width: 90,
            height: 32,
            href: "/",
        },
        description:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed ut mauris eros. Nulla quis ante sed tortor efficitur facilisis.",
        socialLinks: [
            { platform: "Facebook", href: "#", icon: "facebook" },
            { platform: "Twitter", href: "#", icon: "twitter" },
            { platform: "YouTube", href: "#", icon: "youtube" },
            { platform: "Instagram", href: "#", icon: "instagram" },
        ],
        navigationSections: [
            {
                title: "Main",
                links: [
                    { text: "Catalog", href: "/catalog" },
                    { text: "Brands", href: "/brands" },
                    { text: "Delivery", href: "/delivery" },
                    { text: "FAQ", href: "/faq" },
                    { text: "Payment", href: "/payment" },
                ],
            },
            {
                title: "Company",
                links: [
                    { text: "About", href: "/about" },
                    { text: "Contacts", href: "/contacts" },
                    { text: "Blog", href: "/blog" },
                    { text: "News", href: "/news" },
                ],
            },
        ],
        contact: {
            phone: "8 800 799 99 99",
            email: "example@example.com",
            address: "St. Petersburg, Nevsky Prospect 28",
            hours: "Daily 10:00–22:00",
        },
        newsletter: {
            title: "Subscribe for updates",
            placeholder: "Your email",
        },
        copyright:
            "Shopping Categories icons by Jaro Sigrist from Noun Project",
    },
};
