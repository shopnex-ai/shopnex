export const BillingForm = ({ children }: { children: React.ReactNode }) => {
    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const formData = Object.fromEntries(data);
        console.log(formData); // This will help you see the form data
    };
    return <form onSubmit={handleSubmit}>{children}</form>;
};
