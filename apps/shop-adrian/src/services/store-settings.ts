export const getStoreSettings = async () => {
    // const payload = await getPayload({ config });
    // const storeSettings = await payload.findGlobal({
    //     slug: "store-settings",
    // });

    // return storeSettings;
    return {
        currency: "USD",
        currencyFormat: "symbol",
        currencySymbol: "$",
        locale: "en-US",
        timezone: "America/Los_Angeles",
        timeFormat: "H:mm",
        dateFormat: "MMMM d, yyyy",
    };
};
