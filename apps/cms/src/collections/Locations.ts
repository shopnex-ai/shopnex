import type { CollectionConfig } from "payload";

import { groups } from "./groups";

export const Locations: CollectionConfig = {
    slug: "locations",
    admin: {
        group: groups.settings,
        useAsTitle: "name",
    },
    fields: [
        {
            name: "name",
            type: "text",
            label: "Location Name",
            required: true,
        },
        {
            name: "address",
            type: "textarea",
            label: "Address",
            required: true,
        },
        {
            name: "coordinates",
            type: "point",
            label: "Coordinates",
        },
        {
            name: "contactPhone",
            type: "text",
            label: "Contact Phone",
        },
        {
            name: "hours",
            type: "textarea",
            admin: {
                description: "e.g., Mon-Fri: 9am - 6pm",
            },
            label: "Opening Hours",
        },
        {
            name: "enabled",
            type: "checkbox",
            admin: {
                position: "sidebar",
            },
            defaultValue: true,
            label: "Enabled",
        },
        {
            name: "isPickupLocation",
            type: "checkbox",
            admin: {
                position: "sidebar",
            },
            defaultValue: false,
            label: "Available for Pickup?",
        },
    ],
};
