export const fetchExchangeRates = async () => {
    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await response.json();

    return data;
};
