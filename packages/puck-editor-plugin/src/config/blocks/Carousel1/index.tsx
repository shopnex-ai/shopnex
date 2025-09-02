import React, { useState, useEffect } from "react";
import { ComponentConfig } from "@measured/puck";
import styles from "./styles.module.css";

export type CarouselSlide = {
    id: string;
    image: string;
    alt: string;
    href?: string;
    backgroundColor?: string;
};

export type Carousel1Props = {
    slides: CarouselSlide[];
    minHeight?: number;
    maxHeight?: number;
    height?: number;
    autoplay?: boolean;
    autoplayInterval?: number;
    showNavigation?: boolean;
    showDots?: boolean;
    containerClass?: string;
};

export const Carousel1: ComponentConfig<Carousel1Props> = {
    fields: {
        slides: {
            type: "array",
            label: "Carousel Slides",
            arrayFields: {
                id: {
                    type: "text",
                    label: "Slide ID",
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
                    label: "Link URL (optional)",
                },
                backgroundColor: {
                    type: "text",
                    label: "Background Color (optional)",
                },
            },
        },
        minHeight: {
            type: "number",
            label: "Minimum Height (px)",
        },
        maxHeight: {
            type: "number",
            label: "Maximum Height (px)",
        },
        height: {
            type: "number",
            label: "Fixed Height (px)",
        },
        autoplay: {
            type: "radio",
            label: "Enable Autoplay",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        autoplayInterval: {
            type: "number",
            label: "Autoplay Interval (seconds)",
        },
        showNavigation: {
            type: "radio",
            label: "Show Navigation Arrows",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        showDots: {
            type: "radio",
            label: "Show Dot Navigation",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
        containerClass: {
            type: "text",
            label: "Container CSS Classes",
        },
    },
    defaultProps: {
        slides: [
            {
                id: "slide1",
                image: "https://chekromul.github.io/uikit-ecommerce-template/images/promo/macbook-new.jpg",
                alt: "New Macbook",
                href: "#",
                backgroundColor: "rgb(11, 10, 18)",
            },
            {
                id: "slide2",
                image: "https://chekromul.github.io/uikit-ecommerce-template/images/promo/iphone.jpg",
                alt: "iPhone",
                href: "#",
                backgroundColor: "#ce071e",
            },
            {
                id: "slide3",
                image: "https://chekromul.github.io/uikit-ecommerce-template/images/promo/ipad.jpg",
                alt: "iPad",
                href: "#",
                backgroundColor: "#1f2024",
            },
        ],
        minHeight: 300,
        maxHeight: 600,
        height: 516,
        autoplay: true,
        autoplayInterval: 5,
        showNavigation: true,
        showDots: true,
        containerClass: "uk-container",
    },
    render: ({
        slides,
        minHeight,
        maxHeight,
        height,
        autoplay,
        autoplayInterval,
        showNavigation,
        showDots,
        containerClass,
    }) => {
        const [currentSlide, setCurrentSlide] = useState(0);

        useEffect(() => {
            if (!autoplay || !slides?.length) return;

            const interval = setInterval(
                () => {
                    setCurrentSlide((prev) => (prev + 1) % slides.length);
                },
                (autoplayInterval || 5) * 1000
            );

            return () => clearInterval(interval);
        }, [autoplay, autoplayInterval, slides?.length]);

        const goToSlide = (index: number) => {
            setCurrentSlide(index);
        };

        const goToPrevious = () => {
            setCurrentSlide(
                (prev) => (prev - 1 + slides.length) % slides.length
            );
        };

        const goToNext = () => {
            setCurrentSlide((prev) => (prev + 1) % slides.length);
        };

        if (!slides?.length) {
            return (
                <div className={styles.carousel}>
                    <div className={styles.carouselItems}>
                        <div className={styles.carouselItem}>
                            <div
                                className={`${containerClass} ${styles.container}`}
                            >
                                <p>
                                    No slides available. Please add slides to
                                    the carousel.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        const carouselStyle = {
            minHeight: minHeight ? `${minHeight}px` : undefined,
            maxHeight: maxHeight ? `${maxHeight}px` : undefined,
            height: height ? `${height}px` : undefined,
        };

        return (
            <section
                className={`uk-position-relative uk-visible-toggle uk-light uk-slideshow ${styles.carousel} ${styles.light}`}
                style={carouselStyle}
                uk-slideshow={`min-height: ${minHeight || 300}; max-height: ${maxHeight || 600};`}
            >
                <ul className={`uk-slideshow-items ${styles.carouselItems}`}>
                    {slides.map((slide, index) => {
                        const isActive = index === currentSlide;
                        const slideStyle = slide.backgroundColor
                            ? { backgroundColor: slide.backgroundColor }
                            : {};

                        return (
                            <li
                                key={slide.id}
                                className={`${styles.carouselItem} ${
                                    isActive
                                        ? `uk-active uk-transition-active ${styles.active}`
                                        : ""
                                }`}
                                style={{
                                    ...slideStyle,
                                    transform: `translateX(${(index - currentSlide) * 100}%)`,
                                }}
                            >
                                {slide.href ? (
                                    <a
                                        href={slide.href}
                                        className={styles.carouselLink}
                                    >
                                        <figure
                                            className={`${containerClass} uk-height-1-1 ${styles.carouselFigure}`}
                                        >
                                            <img
                                                src={slide.image}
                                                alt={slide.alt}
                                                width="1200"
                                                height="600"
                                                className={`uk-cover ${styles.carouselImage}`}
                                                uk-cover=""
                                            />
                                        </figure>
                                    </a>
                                ) : (
                                    <figure
                                        className={`${containerClass} uk-height-1-1 ${styles.carouselFigure}`}
                                    >
                                        <img
                                            src={slide.image}
                                            alt={slide.alt}
                                            width="1200"
                                            height="600"
                                            className={`uk-cover ${styles.carouselImage}`}
                                            uk-cover=""
                                        />
                                    </figure>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {/* Navigation arrows */}
                {showNavigation && (
                    <>
                        <button
                            className={`uk-position-center-left uk-position-small uk-hidden-hover uk-slidenav-previous uk-icon uk-slidenav ${styles.navPrev}`}
                            onClick={goToPrevious}
                            uk-slideshow-item="previous"
                            uk-slidenav-previous=""
                            aria-label="Previous slide"
                        >
                            <svg
                                width="14"
                                height="24"
                                viewBox="0 0 14 24"
                                xmlns="http://www.w3.org/2000/svg"
                                className={styles.navIcon}
                            >
                                <polyline
                                    fill="none"
                                    stroke="#000"
                                    strokeWidth="1.4"
                                    points="12.775,1 1.225,12 12.775,23"
                                />
                            </svg>
                        </button>
                        <button
                            className={`uk-position-center-right uk-position-small uk-hidden-hover uk-slidenav-next uk-icon uk-slidenav ${styles.navNext}`}
                            onClick={goToNext}
                            uk-slideshow-item="next"
                            uk-slidenav-next=""
                            aria-label="Next slide"
                        >
                            <svg
                                width="14"
                                height="24"
                                viewBox="0 0 14 24"
                                xmlns="http://www.w3.org/2000/svg"
                                className={styles.navIcon}
                            >
                                <polyline
                                    fill="none"
                                    stroke="#000"
                                    strokeWidth="1.4"
                                    points="1.225,23 12.775,12 1.225,1"
                                />
                            </svg>
                        </button>
                    </>
                )}

                {/* Dot navigation */}
                {showDots && (
                    <div className="uk-position-bottom-center uk-position-small">
                        <ul
                            className={`uk-slideshow-nav uk-dotnav ${styles.dotNav}`}
                        >
                            {slides.map((_, index) => (
                                <li
                                    key={index}
                                    uk-slideshow-item={index.toString()}
                                    className={
                                        index === currentSlide
                                            ? "uk-active"
                                            : ""
                                    }
                                >
                                    <button
                                        className={`${styles.dot} ${
                                            index === currentSlide
                                                ? styles.active
                                                : ""
                                        }`}
                                        onClick={() => goToSlide(index)}
                                        aria-label={`Go to slide ${index + 1}`}
                                    />
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>
        );
    },
};
