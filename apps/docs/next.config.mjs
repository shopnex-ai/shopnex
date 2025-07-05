import nextra from "nextra";

// Set up Nextra with its configuration
const withNextra = nextra({
    // ... Add Nextra-specific options here
    search: false,
});

// Export the final Next.js config with Nextra included
export default withNextra({
    output: "export",
    images: {
        unoptimized: true,
    },
    // ... Add regular Next.js options here
});
