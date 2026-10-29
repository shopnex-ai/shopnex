import axios, {
    type AxiosError,
    type AxiosInstance,
    type AxiosResponse,
} from "axios";

import { handleCJError } from "./error-handler";

export const cjApiClient: AxiosInstance = axios.create({
    baseURL: "https://developers.cjdropshipping.com/api2.0/v1/",
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 20000,
});

// Response interceptor for automatic error handling
cjApiClient.interceptors.response.use(
    (response: AxiosResponse) => {
        if (response.data.code !== 200) {
            handleCJError(response.data);
        }
        return response;
    },
    (error: AxiosError) => {
        if (error.response) {
            // Handle CJ API errors
            handleCJError(
                error.response.data as { code: number; message?: string }
            );
        } else if (error.request) {
            throw new Error("Network error: No response from CJ API");
        } else {
            throw new Error(`Axios error: ${error.message}`);
        }
    }
);
