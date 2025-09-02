import React from "react";
import { ComponentConfig } from "@measured/puck";
import "./subscribe.css";

export type SubscribeProps = {
    title: string;
    subtitle: string;
    placeholder: string;
    buttonText: string;
    backgroundColor: string;
    textColor: string;
};

export const Subscribe: ComponentConfig<SubscribeProps> = {
    label: "Subscribe",
    fields: {
        title: {
            type: "text",
            placeholder: "Subscribe for updates",
            contentEditable: true,
        },
        subtitle: {
            type: "text",
            placeholder: "Be aware of new products and special offers.",
            contentEditable: true,
        },
        placeholder: {
            type: "text",
            placeholder: "Your email",
        },
        buttonText: {
            type: "text",
            placeholder: "subscribe",
            contentEditable: true,
        },
        backgroundColor: {
            type: "text",
            placeholder: "#1E87F0",
        },
        textColor: {
            type: "text",
            placeholder: "#FFFFFF",
        },
    },
    defaultProps: {
        title: "Subscribe for updates",
        subtitle: "Be aware of new products and special offers.",
        placeholder: "Your email",
        buttonText: "subscribe",
        backgroundColor: "#1E87F0",
        textColor: "#FFFFFF",
    },
    render: ({ title, subtitle, placeholder, buttonText, backgroundColor, textColor, puck }) => {
        const handleSubmit = (e: React.FormEvent) => {
            if (puck.isEditing) {
                e.preventDefault();
            }
        };

        return (
            <section 
                className="subscribe-section"
                style={{ 
                    backgroundColor: backgroundColor || 'rgb(30, 135, 240)',
                    color: textColor ? `${textColor}B3` : 'rgba(255, 255, 255, 0.7)'
                }}
            >
                <div className="subscribe-container">
                    <div className="subscribe-header">
                        <div 
                            className="subscribe-title"
                            style={{ color: textColor || 'rgba(255, 255, 255, 0.7)' }}
                        >
                            {title}
                        </div>
                        <div className="subscribe-subtitle">
                            {subtitle}
                        </div>
                    </div>
                    <div className="subscribe-form-wrapper">
                        <form onSubmit={handleSubmit}>
                            <div className="subscribe-form-grid">
                                <div className="subscribe-input-wrapper">
                                    <span className="subscribe-icon">
                                        <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                            <polyline fill="none" stroke="#000" points="1.4,6.5 10,11 18.6,6.5"></polyline>
                                            <path d="M 1,4 1,16 19,16 19,4 1,4 Z M 18,15 2,15 2,5 18,5 18,15 Z"></path>
                                        </svg>
                                    </span>
                                    <input 
                                        className="subscribe-input"
                                        type="email" 
                                        placeholder={placeholder}
                                        required
                                        tabIndex={puck.isEditing ? -1 : undefined}
                                    />
                                </div>
                                <div>
                                    <button 
                                        type="submit"
                                        className="subscribe-button"
                                        tabIndex={puck.isEditing ? -1 : undefined}
                                    >
                                        {buttonText}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </section>
        );
    },
};