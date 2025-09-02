import { ComponentConfig } from "@measured/puck";
import "./styles.scss";

interface ContactInformationProps {
    title?: string;
    fields?: Array<{
        name: string;
        label: string;
        type: "text" | "email" | "tel";
        required?: boolean;
        placeholder?: string;
        width?: "full" | "half";
    }>;
}

const ContactInformationComponent = ({
    title = "Contact Information",
    fields = [
        {
            name: "firstName",
            label: "First Name",
            type: "text",
            required: true,
            placeholder: "",
            width: "half"
        },
        {
            name: "lastName",
            label: "Last Name",
            type: "text",
            required: true,
            placeholder: "",
            width: "half"
        },
        {
            name: "phone",
            label: "Phone Number",
            type: "tel",
            required: true,
            placeholder: "",
            width: "half"
        },
        {
            name: "email",
            label: "Email",
            type: "email",
            required: true,
            placeholder: "",
            width: "half"
        }
    ]
}: ContactInformationProps) => {
    return (
        <section className="contact-information">
            <h2 className="contact-information__title">{title}</h2>
            <div className="contact-information__card">
                <div className="contact-information__form">
                    <div className="contact-information__grid">
                        {fields.map((field, index) => (
                            <div 
                                key={index} 
                                className={`contact-information__field ${
                                    field.width === "full" 
                                        ? "contact-information__field--full" 
                                        : "contact-information__field--half"
                                }`}
                            >
                                <label className="contact-information__label">
                                    <div className={`contact-information__label-text ${
                                        field.required ? "contact-information__label-text--required" : ""
                                    }`}>
                                        {field.label}
                                    </div>
                                    <input
                                        className="contact-information__input"
                                        type={field.type}
                                        name={field.name}
                                        placeholder={field.placeholder}
                                        required={field.required}
                                    />
                                </label>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

export const ContactInformation: ComponentConfig<ContactInformationProps> = {
    render: ContactInformationComponent,
    label: "Contact Information",
    fields: {
        title: {
            type: "text"
        },
        fields: {
            type: "array",
            arrayFields: {
                name: { type: "text" },
                label: { type: "text" },
                type: {
                    type: "select",
                    options: [
                        { label: "Text", value: "text" },
                        { label: "Email", value: "email" },
                        { label: "Phone", value: "tel" }
                    ]
                },
                required: {
                    type: "radio",
                    options: [
                        { label: "Yes", value: true },
                        { label: "No", value: false }
                    ]
                },
                placeholder: { type: "text" },
                width: {
                    type: "select",
                    options: [
                        { label: "Full Width", value: "full" },
                        { label: "Half Width", value: "half" }
                    ]
                }
            }
        }
    },
    defaultProps: {
        title: "Contact Information",
        fields: [
            {
                name: "firstName",
                label: "First Name",
                type: "text",
                required: true,
                placeholder: "",
                width: "half"
            },
            {
                name: "lastName",
                label: "Last Name",
                type: "text",
                required: true,
                placeholder: "",
                width: "half"
            },
            {
                name: "phone",
                label: "Phone Number",
                type: "tel",
                required: true,
                placeholder: "",
                width: "half"
            },
            {
                name: "email",
                label: "Email",
                type: "email",
                required: true,
                placeholder: "",
                width: "half"
            }
        ]
    }
};