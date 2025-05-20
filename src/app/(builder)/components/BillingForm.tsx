"use client";

import { useCallback, useState } from "react";

export const BillingForm = ({ children }: { children: React.ReactNode }) => {
    const [formData, setFormData] = useState<Record<string, string>>({});

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const { name, value } = e.target;
            setFormData((prev) => ({
                ...prev,
                [name]: value,
            }));
        },
        []
    );

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        console.log(formData);
    };

    return (
        <form onChange={handleChange} onSubmit={handleSubmit}>
            {children}
        </form>
    );
};
