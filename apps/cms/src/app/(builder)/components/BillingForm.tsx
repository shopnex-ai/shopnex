"use client";

export const BillingForm = ({ children }: { children: React.ReactNode }) => {
    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        console.log(formData);
    };

    return <form onSubmit={handleSubmit}>{children}</form>;
};
