const CJ_ERROR_MESSAGES: Record<number, string> = {
    200: "Success",
    1600000: "System busy. Please try again later.",
    1600001: "No permission. CJ-Access-Token is invalid.",
    1600002: "CJ-Access-Token not found.",
    1600003: "Refresh token failed.",
    1600100: "The interface has been taken offline. Contact admin.",
    1600101: "Interface not found. Check the endpoint URL.",
    1600200: "Call exceeded limit. Try again later.",
    1600201: "Quota has been used up. Contact support.",
    1600300: "Illegal parameter. Check API documentation.",
    1601000: "User not found. Check your email.",
    1602000: "Variant not found.",
    1602001: "Product not found or offline.",
    1603000: "Order creation failed. Contact CJ support.",
    1603001: "Order confirmation failed. Contact CJ support.",
    1603002: "Order deletion failed. Contact CJ support.",
    1603100: "Order not found. Check CJ order ID.",
    1603101: "Order payment failed. Contact CJ Order Center.",
    1604000: "Insufficient balance.",
    1605000: "Logistics not found.",
    1606000: "Webhook setup failed. Already exists.",
    1606001: "Webhook setup failed. Contact CJ support.",
    1607000: "Webhook URL error. URL cannot be empty.",
};

/**
 * Gets a human-readable error message for a given error code.
 */
function getCJErrorMessage(code: number): string {
    return CJ_ERROR_MESSAGES[code] || `Unknown error: ${code}`;
}

/**
 * Throws a formatted error based on the API response.
 */
function handleCJError(response: { code: number; message?: string }): never {
    const errorMessage = response.message || getCJErrorMessage(response.code);
    const error = new Error(`CJ API Error (${response.code}): ${errorMessage}`);
    (error as any).code = response.code;
    throw error;
}

export { getCJErrorMessage, handleCJError };
